import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from 'livekit-client';
import { environment } from '../../../environments/environment';
import { VoiceParticipant, VoiceTokenResponse } from '../models/voice.models';

/**
 * The LiveKit media layer (Slice 2 — audio). Owns the single active `Room`: fetches a channel-scoped
 * token from the API, connects to LiveKit Cloud (URL is server-provided, authoritative), publishes the
 * microphone, and attaches/detaches remote audio to hidden `<audio>` elements. Media flows client ↔
 * Cloud directly — the backend only mints the token + tracks ephemeral voice-state (see VoiceStore for
 * the roster/state, which rides SignalR). Video/screenshare land in Slice 3.
 */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private room: Room | null = null;
  // trackSid → the hidden <audio> playing it, so we can detach on unsubscribe / cleanup.
  private readonly audioEls = new Map<string, HTMLMediaElement>();
  private deafened = false;
  private onEnded: (() => void) | null = null;

  /** userIds currently speaking (LiveKit active-speaker detection) — drives the roster highlight. */
  readonly speakingUserIds = signal<ReadonlySet<string>>(new Set());

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
      joinedAt: Number(p['joinedAt']),
    }));
  }

  /**
   * Connects to a channel's voice room and starts publishing the microphone. `onEnded` fires if the
   * room drops for any reason we didn't initiate (network loss, server close) so the store can reset.
   * Any existing room is torn down first (single active call, Discord-style).
   */
  async connect(channelId: string, onEnded: () => void): Promise<void> {
    await this.disconnect();

    const { token, url } = await this.getToken(channelId);
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.wire(room);

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);

    this.room = room;
    this.onEnded = onEnded;
    // Re-apply deafen if it was toggled before connecting.
    if (this.deafened) this.applyDeafen();
  }

  private wire(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio || !track.sid) return; // video is Slice 3
      const el = track.attach();
      el.muted = this.deafened;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.audioEls.set(track.sid, el);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (!track.sid) return;
      const el = this.audioEls.get(track.sid);
      if (el) {
        track.detach(el);
        el.remove();
        this.audioEls.delete(track.sid);
      }
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
    });

    room.on(RoomEvent.Disconnected, () => {
      const ended = this.onEnded;
      this.teardown();
      ended?.(); // let the store reset its active-channel state
    });
  }

  /** Leaves the room (initiated locally) and detaches all audio. Safe to call when not connected. */
  async disconnect(): Promise<void> {
    const room = this.room;
    this.onEnded = null; // a local disconnect must not re-fire the store's onEnded reset
    this.teardown();
    await room?.disconnect();
  }

  private teardown(): void {
    for (const el of this.audioEls.values()) {
      el.remove();
    }
    this.audioEls.clear();
    this.speakingUserIds.set(new Set());
    this.room = null;
  }

  /** Mutes/unmutes the local microphone publication. */
  setMicMuted(muted: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
  }

  /** Deafen = silence all incoming audio (and, by convention, also mute your own mic — the store does that). */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyDeafen();
  }

  private applyDeafen(): void {
    for (const el of this.audioEls.values()) {
      el.muted = this.deafened;
    }
  }
}
