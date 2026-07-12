import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  LocalVideoTrack,
  RemoteTrack,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';
import { environment } from '../../../environments/environment';
import { VoiceParticipant, VoiceTokenResponse } from '../models/voice.models';
import { VoicePrefsService } from './voice-prefs.service';

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

  private room: Room | null = null;
  // Bumped by every disconnect()/new connect(); an in-flight connect() whose epoch is stale by the
  // time the socket opens tears its Room down instead of keeping it — otherwise a leave-during-join
  // leaks a live Room nobody references, whose reconnect loop hammers the LiveKit wss endpoint.
  private connectEpoch = 0;
  // trackSid → the hidden <audio> playing it + whose it is, so we can detach on unsubscribe /
  // cleanup and apply per-user local mute/volume.
  private readonly audioEls = new Map<string, { el: HTMLMediaElement; identity: string }>();
  private deafened = false;
  private onEnded: (() => void) | null = null;

  /** userIds currently speaking (LiveKit active-speaker detection) — drives the roster highlight. */
  readonly speakingUserIds = signal<ReadonlySet<string>>(new Set());

  /** identity (= userId) → their publishable video tracks, local participant included. */
  readonly videoTracks = signal<ReadonlyMap<string, ParticipantVideoTracks>>(new Map());

  /**
   * True while the local screenshare publication exists. Flips false when the browser's own
   * "Stop sharing" bar unpublishes it, so the store can sync + rebroadcast the flag.
   */
  readonly localScreenShareOn = signal(false);

  /** Per-user local volume (0..1) — a client-side preference, kept for the whole session. */
  readonly volumes = signal<ReadonlyMap<string, number>>(new Map());

  /** Users locally muted "for me" — a client-side preference, kept for the whole session. */
  readonly locallyMutedUserIds = signal<ReadonlySet<string>>(new Set());

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

    const { token, url } = await this.getToken(channelId);
    const prefs = this.prefs.prefs();
    const room = new Room({
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

    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch {
      // No mic (denied/missing device): stay in the call listen-only; the user can retry unmute.
    }

    // Re-apply deafen if it was toggled before connecting.
    if (this.deafened) this.applyAudioPrefs();
  }

  private wire(room: Room): void {
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video) {
          this.setVideoTrack(participant.identity, slotOf(pub), track as RemoteVideoTrack);
          return;
        }
        if (track.kind !== Track.Kind.Audio || !track.sid) return;
        const el = track.attach();
        el.muted = this.isSilenced(participant.identity);
        el.volume = this.volumes().get(participant.identity) ?? 1;
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audioEls.set(track.sid, { el, identity: participant.identity });
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

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ identity: string }>) => {
      this.speakingUserIds.set(new Set(speakers.map((s) => s.identity)));
    });

    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      // Drop any lingering speaker highlight for someone who left.
      if (this.speakingUserIds().has(p.identity)) {
        const next = new Set(this.speakingUserIds());
        next.delete(p.identity);
        this.speakingUserIds.set(next);
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
    this.speakingUserIds.set(new Set());
    // Tracks die with the room; the per-user volume/local-mute *preferences* survive the session.
    this.videoTracks.set(new Map());
    this.localScreenShareOn.set(false);
    this.room = null;
  }

  /** Mutes/unmutes the local microphone publication. */
  setMicMuted(muted: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
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
      await this.room.localParticipant.setScreenShareEnabled(on, { audio: true });
      return on;
    } catch {
      return !on;
    }
  }

  /** Enumerates local media devices of a kind (labels need a prior permission grant). */
  listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
    return Room.getLocalDevices(kind, false).catch(() => []);
  }

  /**
   * Applies a device preference live to the active call (no-op when not in one — the preference
   * still lands via capture defaults on the next connect). deviceId null = system default.
   */
  async switchActiveDevice(kind: MediaDeviceKind, deviceId: string | null): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice(kind, deviceId ?? 'default').catch(() => {});
  }

  /** Sets a per-user local playback volume (0..1). A client-side preference only. */
  setParticipantVolume(userId: string, volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    const next = new Map(this.volumes());
    next.set(userId, clamped);
    this.volumes.set(next);
    this.applyAudioPrefs();
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

  /** Re-applies deafen + per-user mute/volume onto every attached audio element. */
  private applyAudioPrefs(): void {
    for (const { el, identity } of this.audioEls.values()) {
      el.muted = this.isSilenced(identity);
      el.volume = this.volumes().get(identity) ?? 1;
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

/** Camera vs screenshare slot of a publication (screen-share audio never reaches the video path). */
function slotOf(pub: { source: Track.Source }): 'camera' | 'screen' {
  return pub.source === Track.Source.ScreenShare ? 'screen' : 'camera';
}
