import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
// livekit-client is a ~heavy dependency; import ONLY types statically (erased at build) and load
// the runtime module (Room/RoomEvent/Track) lazily on first voice use — see loadLk(). This keeps
// the whole library out of the eager /app shell chunk for users who never open a call.
import type {
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
  Track,
} from 'livekit-client';
import { environment } from '../../../environments/environment';
import { VoiceParticipant, VoiceTokenResponse } from '../models/voice.models';
import { VoicePrefsService } from './voice-prefs.service';

type LiveKitModule = typeof import('livekit-client');

// --- Client-side speaking detection (WebAudio) ---------------------------------------------------
// LiveKit's ActiveSpeakersChanged is computed server-side and pushed on a coarse interval, which
// reads as laggy/inaccurate next to Discord. Instead we run a local AnalyserNode over every
// subscribed mic track (plus our own) and poll RMS at SPEAKING_POLL_MS — instant attack, short
// release so the ring doesn't flicker between words.
const SPEAKING_POLL_MS = 80;
const SPEAKING_RMS_THRESHOLD = 0.02;
const SPEAKING_RELEASE_MS = 300;

interface SpeechSource {
  identity: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  lastAbove: number;
}

/** The attachable video tracks a participant is publishing, camera and screenshare slotted apart. */
export interface ParticipantVideoTracks {
  camera?: LocalVideoTrack | RemoteVideoTrack;
  screen?: LocalVideoTrack | RemoteVideoTrack;
}

/**
 * The LiveKit media layer (Slices 2+3 — audio, camera, screenshare). Owns the single active `Room`:
 * fetches a channel-scoped token from the API, connects to LiveKit Cloud (URL is server-provided,
 * authoritative), publishes the microphone, attaches/detaches remote audio to hidden `<audio>`
 * elements, and surfaces video tracks (local included) as a signal for the tiles to attach. Media
 * flows client ↔ Cloud directly — the backend only mints the token + tracks ephemeral voice-state
 * (see VoiceStore for the roster/state, which rides SignalR).
 */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly http = inject(HttpClient);
  private readonly prefs = inject(VoicePrefsService);
  private readonly base = environment.apiUrl;

  // Lazily-loaded livekit-client runtime module (Room/RoomEvent/Track), cached after first use.
  private lk: LiveKitModule | null = null;
  private room: Room | null = null;
  // Bumped by every disconnect()/new connect(); an in-flight connect() whose epoch is stale by the
  // time the socket opens tears its Room down instead of keeping it — otherwise a leave-during-join
  // leaks a live Room nobody references, whose reconnect loop hammers the LiveKit wss endpoint.
  private connectEpoch = 0;
  // trackSid → the hidden <audio> playing it, whose it is, and which source it is (mic vs the
  // participant's screen-share audio), so we can detach on unsubscribe / cleanup and apply the
  // right per-user local mute/volume (voice and stream audio have independent volume).
  private readonly audioEls = new Map<
    string,
    { el: HTMLMediaElement; identity: string; source: 'mic' | 'screen' }
  >();
  private deafened = false;
  private onEnded: (() => void) | null = null;
  // userIds whose screenshare AUDIO this viewer consumes — stream audio is watch-gated (synced
  // from the store's click-to-watch set), so non-watchers neither hear nor download it.
  private watchedStreams: ReadonlySet<string> = new Set();
  // Client-side speaking detection: one shared AudioContext + an analyser per live mic track,
  // polled on speechTimer. Keyed by trackSid (remote) / 'local-mic' (own mic).
  private speechCtx: AudioContext | null = null;
  private speechTimer: ReturnType<typeof setInterval> | null = null;
  private readonly speechSources = new Map<string, SpeechSource>();
  // The in-flight mic publish. connect() no longer blocks the join on getUserMedia (it's the
  // slowest step); mute toggles chain behind this so a quick mute-at-join can't race the enable.
  private micReady: Promise<unknown> = Promise.resolve();

  /** userIds currently speaking (LiveKit active-speaker detection) — drives the roster highlight. */
  readonly speakingUserIds = signal<ReadonlySet<string>>(new Set());

  /** identity (= userId) → their publishable video tracks, local participant included. */
  readonly videoTracks = signal<ReadonlyMap<string, ParticipantVideoTracks>>(new Map());

  /**
   * True while the local screenshare publication exists. Flips false when the browser's own
   * "Stop sharing" bar unpublishes it, so the store can sync + rebroadcast the flag.
   */
  readonly localScreenShareOn = signal(false);

  /** Per-user local voice (mic) volume (0..1) — a client-side preference, kept for the whole session. */
  readonly volumes = signal<ReadonlyMap<string, number>>(new Map());

  /** Per-user local screen-share *audio* volume (0..1), independent of their mic — session-scoped. */
  readonly screenVolumes = signal<ReadonlyMap<string, number>>(new Map());

  /** Users locally muted "for me" — a client-side preference, kept for the whole session. */
  readonly locallyMutedUserIds = signal<ReadonlySet<string>>(new Set());

  /** Loads (once, then cached) the livekit-client runtime module — the lazy code-split boundary. */
  private async loadLk(): Promise<LiveKitModule> {
    return (this.lk ??= await import('livekit-client'));
  }

  /** Mints a channel-scoped LiveKit token (+ the Cloud URL and room name) from the API. */
  getToken(channelId: string): Promise<VoiceTokenResponse> {
    return firstValueFrom(
      this.http.post<VoiceTokenResponse>(`${this.base}/channels/${channelId}/voice/token`, {}),
    );
  }

  /** The current voice roster for a channel (seed on open; live deltas arrive over SignalR). */
  async getParticipants(channelId: string): Promise<VoiceParticipant[]> {
    const raw = await firstValueFrom(
      this.http.get<Array<Record<string, unknown>>>(
        `${this.base}/channels/${channelId}/voice/participants`,
      ),
    );
    return (raw ?? []).map((p) => ({
      channelId: String(p['channelId']),
      guildId: p['guildId'] != null ? String(p['guildId']) : null,
      userId: String(p['userId']),
      isMuted: Boolean(p['isMuted']),
      isDeafened: Boolean(p['isDeafened']),
      isVideoOn: Boolean(p['isVideoOn']),
      isStreaming: Boolean(p['isStreaming']),
      isServerMuted: Boolean(p['isServerMuted']),
      isServerDeafened: Boolean(p['isServerDeafened']),
      joinedAt: Number(p['joinedAt']),
    }));
  }

  /**
   * Connects to a channel's voice room and starts publishing the microphone. `onEnded` fires if the
   * room drops for any reason we didn't initiate (network loss, server close) so the store can reset.
   * Any existing room is torn down first (single active call, Discord-style).
   * `maxAudioBitrateBps` is the voice channel's configured bitrate (null/undefined = LiveKit's
   * default — DM calls and unconfigured channels).
   */
  async connect(
    channelId: string,
    onEnded: () => void,
    maxAudioBitrateBps?: number | null,
  ): Promise<void> {
    await this.disconnect();
    const epoch = ++this.connectEpoch;

    // Load livekit-client + the token in parallel — first-call chunk fetch overlaps the API RTT.
    const [lk, { token, url }] = await Promise.all([this.loadLk(), this.getToken(channelId)]);
    const prefs = this.prefs.prefs();
    const room = new lk.Room({
      adaptiveStream: true,
      dynacast: true,
      // Device + audio-processing preferences apply at track creation; a null deviceId falls
      // back to the system default.
      audioCaptureDefaults: {
        deviceId: prefs.micDeviceId ?? undefined,
        noiseSuppression: prefs.noiseSuppression,
        echoCancellation: prefs.echoCancellation,
        autoGainControl: prefs.autoGainControl,
      },
      videoCaptureDefaults: { deviceId: prefs.cameraDeviceId ?? undefined },
      audioOutput: { deviceId: prefs.speakerDeviceId ?? undefined },
      publishDefaults: maxAudioBitrateBps
        ? { audioPreset: { maxBitrate: maxAudioBitrateBps } }
        : undefined,
    });
    this.wire(room);

    try {
      await room.connect(url, token);
    } catch (err) {
      room.removeAllListeners();
      throw err;
    }

    // A disconnect (or a newer connect) raced this one while the socket was opening — this room
    // must not survive, or it leaks as an unreachable connection that retries forever.
    if (epoch !== this.connectEpoch) {
      room.removeAllListeners();
      await room.disconnect().catch(() => {});
      throw new Error('voice connect superseded by a disconnect');
    }

    // Make the room reachable BEFORE enabling the mic: a mic permission/device failure must not
    // orphan a fully connected Room (disconnect() could never reach it → leaked reconnect loop).
    this.room = room;
    this.onEnded = onEnded;

    // Publish the mic WITHOUT blocking the join — getUserMedia (permission prompt / device
    // spin-up) is routinely the slowest step and nothing else depends on it. A failure leaves
    // us in the call listen-only; the user can retry via unmute.
    this.micReady = room.localParticipant
      .setMicrophoneEnabled(true)
      .catch(() => {})
      .finally(() => this.refreshLocalMicAnalyser());

    // Re-apply deafen if it was toggled before connecting.
    if (this.deafened) this.applyAudioPrefs();
  }

  private wire(room: Room): void {
    // Runtime enums off the lazily-loaded module (wire only runs after connect() loaded it).
    const { RoomEvent, Track } = this.lk!;
    const slotOf = (pub: { source: Track.Source }): 'camera' | 'screen' =>
      pub.source === Track.Source.ScreenShare ? 'screen' : 'camera';
    const audioSourceOf = (pub: { source: Track.Source }): 'mic' | 'screen' =>
      pub.source === Track.Source.ScreenShareAudio ? 'screen' : 'mic';

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video) {
          this.setVideoTrack(participant.identity, slotOf(pub), track as RemoteVideoTrack);
          return;
        }
        if (track.kind !== Track.Kind.Audio || !track.sid) return;
        const source = audioSourceOf(pub);
        // Watch-gated stream audio: not watching → drop the auto-subscription instead of
        // attaching, so the audio is neither heard nor downloaded until the viewer opts in.
        if (source === 'screen' && !this.watchedStreams.has(participant.identity)) {
          pub.setSubscribed(false);
          return;
        }
        const el = track.attach();
        el.muted = this.isSilenced(participant.identity);
        el.volume = this.volumeFor(participant.identity, source);
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audioEls.set(track.sid, { el, identity: participant.identity, source });
        // Mic tracks feed the local speaking detector (screen audio must not light the ring).
        if (source === 'mic') {
          this.addSpeechSource(track.sid, participant.identity, track.mediaStreamTrack);
        }
      },
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video) {
          // Clear the slot only if it still holds this exact track (a republish may have raced).
          if (this.videoTracks().get(participant.identity)?.[slotOf(pub)] === track) {
            this.setVideoTrack(participant.identity, slotOf(pub), undefined);
          }
          return;
        }
        if (!track.sid) return;
        this.removeSpeechSource(track.sid);
        const entry = this.audioEls.get(track.sid);
        if (entry) {
          track.detach(entry.el);
          entry.el.remove();
          this.audioEls.delete(track.sid);
        }
      },
    );

    // Local publications feed the same video map, giving the own-camera preview + own screen tile.
    room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.track?.kind !== Track.Kind.Video) return;
      const slot = slotOf(pub);
      this.setVideoTrack(room.localParticipant.identity, slot, pub.track as LocalVideoTrack);
      if (slot === 'screen') this.localScreenShareOn.set(true);
    });

    room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      if (pub.track?.kind !== Track.Kind.Video) return;
      const slot = slotOf(pub);
      this.setVideoTrack(room.localParticipant.identity, slot, undefined);
      if (slot === 'screen') this.localScreenShareOn.set(false);
    });

    // NOTE: speaking detection deliberately does NOT use RoomEvent.ActiveSpeakersChanged — that's
    // computed server-side and pushed on a coarse interval (visibly delayed). The local analyser
    // set (addSpeechSource/pollSpeaking) drives speakingUserIds instead.

    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      // Drop any lingering analyser/highlight for someone who left (unsubscribes usually precede
      // this, but not guaranteed).
      for (const [key, entry] of [...this.speechSources]) {
        if (entry.identity === p.identity) this.removeSpeechSource(key);
      }
      // And any video slots of theirs (unsubscribes usually precede this, but not guaranteed).
      if (this.videoTracks().has(p.identity)) {
        const next = new Map(this.videoTracks());
        next.delete(p.identity);
        this.videoTracks.set(next);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      const ended = this.onEnded;
      room.removeAllListeners(); // this room is done — nothing may re-trigger reconnect handling
      this.teardown();
      ended?.(); // let the store reset its active-channel state
    });
  }

  /** Leaves the room (initiated locally) and detaches all audio. Safe to call when not connected. */
  async disconnect(): Promise<void> {
    this.connectEpoch++; // invalidate any connect() still in flight
    const room = this.room;
    this.onEnded = null; // a local disconnect must not re-fire the store's onEnded reset
    this.teardown();
    if (room) {
      room.removeAllListeners();
      await room.disconnect();
    }
  }

  private teardown(): void {
    for (const { el } of this.audioEls.values()) {
      el.remove();
    }
    this.audioEls.clear();
    if (this.speechTimer) {
      clearInterval(this.speechTimer);
      this.speechTimer = null;
    }
    for (const key of [...this.speechSources.keys()]) this.removeSpeechSource(key);
    if (this.speechCtx) {
      void this.speechCtx.close().catch(() => {});
      this.speechCtx = null;
    }
    this.micReady = Promise.resolve();
    this.speakingUserIds.set(new Set());
    // Tracks die with the room; the per-user volume/local-mute *preferences* survive the session.
    this.videoTracks.set(new Map());
    this.localScreenShareOn.set(false);
    this.room = null;
  }

  /** Mutes/unmutes the local microphone publication (chained behind the initial mic publish). */
  setMicMuted(muted: boolean): void {
    const room = this.room;
    if (!room) return;
    this.micReady = this.micReady
      .then(() => room.localParticipant.setMicrophoneEnabled(!muted))
      .catch(() => {});
  }

  /** Deafen = silence all incoming audio (and, by convention, also mute your own mic — the store does that). */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyAudioPrefs();
  }

  /**
   * Publishes/unpublishes the camera. Returns the *resulting* enabled state — a device error or
   * permission denial resolves to the old state so the caller's flag stays truthful.
   */
  async setCameraEnabled(on: boolean): Promise<boolean> {
    if (!this.room) return false;
    try {
      await this.room.localParticipant.setCameraEnabled(on);
      return on;
    } catch {
      return !on;
    }
  }

  /**
   * Starts/stops screensharing (with tab audio when the browser offers it). Returns the resulting
   * state — cancelling the browser's picker rejects and resolves to the old state, no error UI needed.
   */
  async setScreenShareEnabled(on: boolean): Promise<boolean> {
    if (!this.room) return false;
    try {
      if (on) {
        const { screenShareResolution, screenShareFps } = this.prefs.prefs();
        // Ceiling stays below 1080p by design (VoicePrefs) so a screenshare can't saturate a slow/
        // tunnelled uplink. `resolution` requests the capture size; `screenShareEncoding` is the hard
        // cap on what's actually sent (bitrate + framerate).
        const dims = screenShareResolution === '480p'
          ? { width: 854, height: 480 }
          : { width: 1280, height: 720 };
        const maxBitrate = screenShareResolution === '480p' ? 1_000_000 : 2_500_000;
        await this.room.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: true,
            resolution: {
              width: dims.width,
              height: dims.height,
              frameRate: screenShareFps,
              aspectRatio: dims.width / dims.height,
            },
          },
          { screenShareEncoding: { maxBitrate, maxFramerate: screenShareFps } },
        );
      } else {
        await this.room.localParticipant.setScreenShareEnabled(false);
      }
      return on;
    } catch (err) {
      // Cancelling the browser picker also lands here (NotAllowedError) — expected, stay silent.
      // Anything else is a genuine capture/publish failure (e.g. Chrome rejecting the screen-audio
      // track) and must be surfaced rather than swallowed into a no-op "share didn't start".
      if ((err as { name?: string })?.name !== 'NotAllowedError') {
        console.error('[voice] setScreenShareEnabled failed', err);
      }
      return !on;
    }
  }

  /** Enumerates local media devices of a kind (labels need a prior permission grant). */
  async listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
    const lk = await this.loadLk();
    return lk.Room.getLocalDevices(kind, false).catch(() => []);
  }

  /**
   * Applies a device preference live to the active call (no-op when not in one — the preference
   * still lands via capture defaults on the next connect). deviceId null = system default.
   */
  async switchActiveDevice(kind: MediaDeviceKind, deviceId: string | null): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice(kind, deviceId ?? 'default').catch(() => {});
    // A mic switch restarts the local track in place (same publication, NEW MediaStreamTrack) —
    // re-point the speaking analyser at the new track or the own-ring goes dead.
    if (kind === 'audioinput') this.refreshLocalMicAnalyser();
  }

  /** Sets a per-user local voice (mic) playback volume (0..1). A client-side preference only. */
  setParticipantVolume(userId: string, volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    const next = new Map(this.volumes());
    next.set(userId, clamped);
    this.volumes.set(next);
    this.applyAudioPrefs();
  }

  /** Sets a per-user local screen-share *audio* volume (0..1), independent of their mic volume. */
  setParticipantScreenVolume(userId: string, volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    const next = new Map(this.screenVolumes());
    next.set(userId, clamped);
    this.screenVolumes.set(next);
    this.applyAudioPrefs();
  }

  /** The local playback volume to apply for a participant's audio of a given source. */
  private volumeFor(identity: string, source: 'mic' | 'screen'): number {
    const map = source === 'screen' ? this.screenVolumes() : this.volumes();
    return map.get(identity) ?? 1;
  }

  /**
   * Applies the click-to-watch set to stream AUDIO: a stream's audio track stays subscribed only
   * while this viewer is watching it (the video side is already covered — adaptiveStream pauses
   * unattached tracks and dynacast then pauses the publisher's upload). Called by the store
   * whenever the watched set changes; new publications are gated at TrackSubscribed.
   */
  syncWatchedStreams(watched: ReadonlySet<string>): void {
    this.watchedStreams = watched;
    if (!this.room || !this.lk) return;
    const screenAudio = this.lk.Track.Source.ScreenShareAudio;
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.source === screenAudio) {
          pub.setSubscribed(watched.has(p.identity));
        }
      }
    }
  }

  /** Mutes/unmutes a user "for me" — silences their audio locally without touching their state. */
  setParticipantLocalMuted(userId: string, muted: boolean): void {
    const next = new Set(this.locallyMutedUserIds());
    if (muted) next.add(userId);
    else next.delete(userId);
    this.locallyMutedUserIds.set(next);
    this.applyAudioPrefs();
  }

  /** Whether a participant's audio should be silenced locally (deafen or a per-user mute). */
  private isSilenced(identity: string): boolean {
    return this.deafened || this.locallyMutedUserIds().has(identity);
  }

  /** Re-applies deafen + per-user mute/volume onto every attached audio element (voice + stream). */
  private applyAudioPrefs(): void {
    for (const { el, identity, source } of this.audioEls.values()) {
      el.muted = this.isSilenced(identity);
      el.volume = this.volumeFor(identity, source);
    }
  }

  // --- speaking detection (local WebAudio analysers) ---

  /** Registers a mic MediaStreamTrack with the speaking detector. Safe to call twice per key. */
  private addSpeechSource(key: string, identity: string, msTrack: MediaStreamTrack | undefined): void {
    if (!msTrack || this.speechSources.has(key)) return;
    try {
      const ctx = (this.speechCtx ??= new AudioContext());
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(new MediaStream([msTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.speechSources.set(key, {
        identity,
        source,
        analyser,
        buf: new Float32Array(analyser.fftSize),
        lastAbove: 0,
      });
      this.speechTimer ??= setInterval(() => this.pollSpeaking(), SPEAKING_POLL_MS);
    } catch {
      // WebAudio unavailable — no speaking ring for this track; audio playback is unaffected.
    }
  }

  private removeSpeechSource(key: string): void {
    const entry = this.speechSources.get(key);
    if (!entry) return;
    entry.source.disconnect();
    this.speechSources.delete(key);
  }

  /** (Re)binds the analyser for our own mic — after the initial publish and on device switches. */
  private refreshLocalMicAnalyser(): void {
    if (!this.room || !this.lk) return;
    this.removeSpeechSource('local-mic');
    const pub = this.room.localParticipant.getTrackPublication(this.lk.Track.Source.Microphone);
    this.addSpeechSource('local-mic', this.room.localParticipant.identity, pub?.track?.mediaStreamTrack);
  }

  /** RMS-thresholds every mic analyser: instant attack, SPEAKING_RELEASE_MS release. */
  private pollSpeaking(): void {
    const now = Date.now();
    const speaking = new Set<string>();
    for (const entry of this.speechSources.values()) {
      entry.analyser.getFloatTimeDomainData(entry.buf);
      let sum = 0;
      for (let i = 0; i < entry.buf.length; i++) sum += entry.buf[i] * entry.buf[i];
      if (Math.sqrt(sum / entry.buf.length) > SPEAKING_RMS_THRESHOLD) entry.lastAbove = now;
      if (entry.lastAbove !== 0 && now - entry.lastAbove < SPEAKING_RELEASE_MS) {
        speaking.add(entry.identity);
      }
    }
    const cur = this.speakingUserIds();
    if (cur.size !== speaking.size || [...speaking].some((id) => !cur.has(id))) {
      this.speakingUserIds.set(speaking);
    }
  }

  /** Slots a video track in (or out of, when undefined) a participant's entry in the signal map. */
  private setVideoTrack(
    identity: string,
    slot: 'camera' | 'screen',
    track: LocalVideoTrack | RemoteVideoTrack | undefined,
  ): void {
    const next = new Map(this.videoTracks());
    const entry: ParticipantVideoTracks = { ...(next.get(identity) ?? {}) };
    if (track) entry[slot] = track;
    else delete entry[slot];
    if (entry.camera || entry.screen) next.set(identity, entry);
    else next.delete(identity);
    this.videoTracks.set(next);
  }
}

