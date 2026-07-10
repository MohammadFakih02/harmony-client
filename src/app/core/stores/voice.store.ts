import { computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { GatewayEvents } from '../hub/gateway-events';
import { SignalRService } from '../services/signalr.service';
import { VoiceService } from '../services/voice.service';
import { AuthService } from '../services/auth.service';
import { VoiceParticipant } from '../models/voice.models';

interface VoiceState {
  // channelId → live voice roster (seeded on join, kept fresh by gateway deltas).
  participantsByChannel: Record<string, VoiceParticipant[]>;
  activeChannelId: string | null; // the voice channel we're connected to (null = not in voice)
  connecting: boolean; // a join is in flight (LiveKit connect + token)
  connectingChannelId: string | null; // which channel that in-flight join targets (drives the row spinner)
  selfMuted: boolean;
  selfDeafened: boolean;
  selfVideoOn: boolean;
  selfStreaming: boolean;
}

/** Replaces (or inserts) a participant in a channel's roster, keyed by userId. */
function upsert(
  map: Record<string, VoiceParticipant[]>,
  p: VoiceParticipant,
): Record<string, VoiceParticipant[]> {
  const rest = (map[p.channelId] ?? []).filter((x) => x.userId !== p.userId);
  return { ...map, [p.channelId]: [...rest, p] };
}

/** Drops a user from a channel's roster. */
function removeFrom(
  map: Record<string, VoiceParticipant[]>,
  channelId: string,
  userId: string,
): Record<string, VoiceParticipant[]> {
  return { ...map, [channelId]: (map[channelId] ?? []).filter((x) => x.userId !== userId) };
}

/**
 * Voice presence + call control (LiveKit Slice 2 — audio). Owns the live roster per channel (fed by
 * the unified gateway stream, seeded from the REST roster on join) and the single active connection.
 * The media itself lives in {@link VoiceService}; this store orchestrates it against the SignalR
 * signaling (JoinVoice/LeaveVoice/UpdateVoiceState) and exposes the state the sidebar + voice bar read.
 * Root-provided and gateway-subscribed from boot (injected in the shell) so rosters stay live even
 * for channels you're only watching, not connected to.
 */
export const VoiceStore = signalStore(
  { providedIn: 'root' },
  withState<VoiceState>({
    participantsByChannel: {},
    activeChannelId: null,
    connecting: false,
    connectingChannelId: null,
    selfMuted: false,
    selfDeafened: false,
    selfVideoOn: false,
    selfStreaming: false,
  }),
  withComputed((store, voice = inject(VoiceService)) => ({
    /** True while connected to (or connecting to) any voice channel. */
    inVoice: computed(() => store.activeChannelId() !== null),
    /** userIds currently speaking (from LiveKit active-speaker detection). */
    speakingUserIds: computed(() => voice.speakingUserIds()),
  })),
  withMethods(
    (
      store,
      voice = inject(VoiceService),
      signalR = inject(SignalRService),
      auth = inject(AuthService),
    ) => {
      const myId = () => auth.currentUser()?.id ?? null;

      /** Patches my own roster entry so the UI reflects a mute/deafen toggle before the echo lands. */
      const patchSelf = (channelId: string, changes: Partial<VoiceParticipant>): void => {
        const mine = (store.participantsByChannel()[channelId] ?? []).find((p) => p.userId === myId());
        if (!mine) return;
        patchState(store, {
          participantsByChannel: upsert(store.participantsByChannel(), { ...mine, ...changes }),
        });
      };

      /** Local teardown shared by leave() and an unexpected room drop. */
      const reset = (channelId: string): void => {
        const id = myId();
        patchState(store, {
          activeChannelId: null,
          connecting: false,
          connectingChannelId: null,
          selfMuted: false,
          selfDeafened: false,
          selfVideoOn: false,
          selfStreaming: false,
          participantsByChannel: id ? removeFrom(store.participantsByChannel(), channelId, id) : store.participantsByChannel(),
        });
      };

      /** Publishes the full self-state tuple — the hub takes all four flags in one invoke. */
      const broadcastSelfState = (): void => {
        signalR.updateVoiceState(
          store.selfMuted(),
          store.selfDeafened(),
          store.selfVideoOn(),
          store.selfStreaming(),
        );
      };

      return {
        participantsOf(channelId: string): VoiceParticipant[] {
          return store.participantsByChannel()[channelId] ?? [];
        },

        /**
         * Joins a channel's voice room: connect media (LiveKit) → publish voice-state (SignalR) → seed
         * the roster. If already in another room, that one is left first (single active call).
         */
        async join(channelId: string): Promise<void> {
          if (store.connecting() || store.activeChannelId() === channelId) return;
          const previous = store.activeChannelId();
          if (previous) await this.leave();

          patchState(store, { connecting: true, connectingChannelId: channelId });
          try {
            // onEnded fires only on an *unexpected* drop (an intentional leave() nulls the callback
            // before disconnecting), so it both resets local state and tells the server we're gone.
            await voice.connect(channelId, () => {
              reset(channelId);
              void signalR.leaveVoice(channelId);
            });
            await signalR.joinVoice(channelId);
            const roster = await voice.getParticipants(channelId);
            patchState(store, {
              activeChannelId: channelId,
              connecting: false,
              connectingChannelId: null,
              selfMuted: false,
              selfDeafened: false,
              selfVideoOn: false,
              selfStreaming: false,
              participantsByChannel: { ...store.participantsByChannel(), [channelId]: roster },
            });
          } catch (err) {
            console.error('[voice] join failed', err);
            await voice.disconnect().catch(() => {});
            patchState(store, { connecting: false, connectingChannelId: null });
          }
        },

        /** Leaves the active voice channel (media + signaling) and clears local voice state. */
        async leave(): Promise<void> {
          const channelId = store.activeChannelId();
          if (!channelId) return;
          reset(channelId);
          await signalR.leaveVoice(channelId);
          await voice.disconnect().catch(() => {});
        },

        /** Toggles the mic. Unmuting while deafened also undeafens (Discord behavior). */
        toggleMute(): void {
          const channelId = store.activeChannelId();
          if (!channelId) return;
          const muted = !store.selfMuted();
          const deafened = muted ? store.selfDeafened() : false; // unmute clears deafen
          patchState(store, { selfMuted: muted, selfDeafened: deafened });
          voice.setMicMuted(muted);
          voice.setDeafened(deafened);
          patchSelf(channelId, { isMuted: muted, isDeafened: deafened });
          broadcastSelfState();
        },

        /** Toggles deafen. Deafening also mutes the mic; undeafening unmutes it (Discord behavior). */
        toggleDeafen(): void {
          const channelId = store.activeChannelId();
          if (!channelId) return;
          const deafened = !store.selfDeafened();
          const muted = deafened; // deafen implies mic-muted; undeafen unmutes
          patchState(store, { selfDeafened: deafened, selfMuted: muted });
          voice.setDeafened(deafened);
          voice.setMicMuted(muted);
          patchSelf(channelId, { isDeafened: deafened, isMuted: muted });
          broadcastSelfState();
        },

        /**
         * Toggles the camera. The published flag follows the *actual* publish result (a device
         * error / permission denial resolves to the old state), so roster and media never drift.
         */
        async toggleCamera(): Promise<void> {
          const channelId = store.activeChannelId();
          if (!channelId) return;
          const on = await voice.setCameraEnabled(!store.selfVideoOn());
          patchState(store, { selfVideoOn: on });
          patchSelf(channelId, { isVideoOn: on });
          broadcastSelfState();
        },

        /** Toggles screensharing. Cancelling the browser's picker resolves back to "off" silently. */
        async toggleScreenShare(): Promise<void> {
          const channelId = store.activeChannelId();
          if (!channelId) return;
          const on = await voice.setScreenShareEnabled(!store.selfStreaming());
          patchState(store, { selfStreaming: on });
          patchSelf(channelId, { isStreaming: on });
          broadcastSelfState();
        },

        /**
         * The share ended outside our UI (the browser's own "Stop sharing" bar) — LiveKit already
         * unpublished the track; this re-aligns the flag and tells everyone else.
         */
        syncScreenShareEnded(): void {
          const channelId = store.activeChannelId();
          if (!channelId || !store.selfStreaming()) return;
          patchState(store, { selfStreaming: false });
          patchSelf(channelId, { isStreaming: false });
          broadcastSelfState();
        },

        // --- gateway handlers (own-state mutation for the live roster) ---
        applyJoined(p: VoiceParticipant): void {
          patchState(store, { participantsByChannel: upsert(store.participantsByChannel(), p) });
        },

        applyStateUpdated(p: VoiceParticipant): void {
          patchState(store, { participantsByChannel: upsert(store.participantsByChannel(), p) });
          // Sync own flags from the echo: the hub clamps unauthorized video/stream flags, so a
          // server-adjusted state must snap the local toggles back too.
          if (p.userId === myId() && p.channelId === store.activeChannelId()) {
            patchState(store, {
              selfMuted: p.isMuted,
              selfDeafened: p.isDeafened,
              selfVideoOn: p.isVideoOn,
              selfStreaming: p.isStreaming,
            });
          }
        },

        applyLeft(channelId: string, userId: string): void {
          // If the server evicted *us* (e.g. we joined voice on another device), tear down locally.
          if (userId === myId() && channelId === store.activeChannelId()) {
            reset(channelId);
            void voice.disconnect().catch(() => {});
            return;
          }
          patchState(store, {
            participantsByChannel: removeFrom(store.participantsByChannel(), channelId, userId),
          });
        },
      };
    },
  ),
  withHooks({
    onInit(store, gateway = inject(GatewayEvents), voice = inject(VoiceService)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'VoiceParticipantJoined':
            store.applyJoined(e.payload);
            break;
          case 'VoiceStateUpdated':
            store.applyStateUpdated(e.payload);
            break;
          case 'VoiceParticipantLeft':
            store.applyLeft(e.payload.channelId, e.payload.userId);
            break;
        }
      });

      // The browser's own "Stop sharing" bar unpublishes the track directly — mirror that back
      // into store state so the toggle and the roster don't stay stuck "streaming".
      effect(() => {
        if (!voice.localScreenShareOn() && store.selfStreaming()) {
          store.syncScreenShareEnded();
        }
      });
    },
  }),
);
