import { computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { GatewayEvents } from '../hub/gateway-events';
import { SignalRService } from '../services/signalr.service';
import { VoiceService } from '../services/voice.service';
import { AuthService } from '../services/auth.service';
import { ChannelStore } from './channel.store';
import { VoiceParticipant } from '../models/voice.models';

/**
 * Grace window before an *unexpected* media drop tells the server we left. A moderator force-move
 * kicks us from the old LiveKit room (an unexpected drop) AND sends VoiceForceMoved; if the move
 * signal wins the race the deferred leave is cancelled, so a stray leaveVoice can't wipe the
 * freshly-moved destination state (the hub's LeaveAsync clears whatever room we're currently in).
 */
const MOVE_GRACE_MS = 2_000;

/**
 * How long you sit ALONE in a guild voice channel before the media room is silently dropped
 * (bandwidth + LiveKit Cloud minutes). Signaling is untouched — the server, everyone's sidebar,
 * and your own UI all still show you connected — and the first joiner resumes media automatically.
 * DM calls are exempt: they get a full 5-min auto-leave from CallStore instead.
 */
const SUSPEND_WHEN_ALONE_MS = 300_000;

interface VoiceState {
  // channelId → live voice roster (seeded on join, kept fresh by gateway deltas).
  participantsByChannel: Record<string, VoiceParticipant[]>;
  activeChannelId: string | null; // the voice channel we're connected to (null = not in voice)
  // The channel this tab last held a live media room for. Set on a successful (re)join, cleared only
  // on an INTENTIONAL leave/cancel — survives an unexpected drop's reset so a force-move that races
  // the LiveKit kick can still recognise this as the tab to reconnect.
  lastRoomChannelId: string | null;
  connecting: boolean; // a join is in flight (LiveKit connect + token)
  connectingChannelId: string | null; // which channel that in-flight join targets (drives the row spinner)
  // Alone-in-guild-channel media suspension: the LiveKit room is dropped but we remain joined for
  // the server and every UI surface ("phantom presence"). resumeMedia() reconnects transparently.
  mediaSuspended: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  selfVideoOn: boolean;
  selfStreaming: boolean;
  // Click-to-watch: streams render as an inert LIVE tile until the viewer opts in (bandwidth —
  // adaptiveStream pauses video nobody attached). Cleared per user when their stream ends, and
  // wholesale on leave. Local-only, like volumes/mute-for-me.
  watchedStreamUserIds: string[];
  // "Hide video for me": camera tiles the viewer collapsed back to an avatar. Survives the call.
  hiddenVideoUserIds: string[];
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
    lastRoomChannelId: null,
    connecting: false,
    connectingChannelId: null,
    mediaSuspended: false,
    selfMuted: false,
    selfDeafened: false,
    selfVideoOn: false,
    selfStreaming: false,
    watchedStreamUserIds: [],
    hiddenVideoUserIds: [],
  }),
  withComputed((store, voice = inject(VoiceService), auth = inject(AuthService)) => {
    const selfEntry = computed(() => {
      const channelId = store.activeChannelId();
      const myId = auth.currentUser()?.id;
      if (!channelId || !myId) return null;
      return (store.participantsByChannel()[channelId] ?? []).find((p) => p.userId === myId) ?? null;
    });
    return {
      /** True while connected to (or connecting to) any voice channel. */
      inVoice: computed(() => store.activeChannelId() !== null),
      /** userIds currently speaking (from LiveKit active-speaker detection). */
      speakingUserIds: computed(() => voice.speakingUserIds()),
      /** Moderator-imposed flags on ME (from my own roster entry) — they lock the local toggles. */
      selfServerMuted: computed(() => selfEntry()?.isServerMuted ?? false),
      selfServerDeafened: computed(() => selfEntry()?.isServerDeafened ?? false),
    };
  }),
  withMethods(
    (
      store,
      voice = inject(VoiceService),
      signalR = inject(SignalRService),
      auth = inject(AuthService),
      channels = inject(ChannelStore),
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
          mediaSuspended: false,
          selfMuted: false,
          selfDeafened: false,
          selfVideoOn: false,
          selfStreaming: false,
          watchedStreamUserIds: [],
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

      /** The channel's configured audio-bitrate cap (guild voice channels only — a DM call isn't
       *  in ChannelStore and rides the LiveKit default). */
      const bitrateOf = (channelId: string): number | null =>
        Object.values(channels.channelsByGuild())
          .flat()
          .find((c) => c.id === channelId)?.bitrate ?? null;

      /** The guild a voice channel belongs to (null for a DM call — not in ChannelStore). */
      const guildOf = (channelId: string): string | null =>
        Object.entries(channels.channelsByGuild()).find(([, list]) =>
          list.some((c) => c.id === channelId),
        )?.[0] ?? null;

      /** An optimistic roster entry for ourselves so the self tile shows the instant we go active —
       *  used to avoid blocking the "connected" UI on the getParticipants round trip. */
      const selfParticipant = (channelId: string): VoiceParticipant => ({
        channelId,
        guildId: guildOf(channelId),
        userId: myId() ?? '',
        isMuted: false,
        isDeafened: false,
        isVideoOn: false,
        isStreaming: false,
        isServerMuted: false,
        isServerDeafened: false,
        joinedAt: Date.now(),
      });

      // Guards resumeMedia() against double-fire (e.g. two joiners landing in the same window).
      let resumingMedia = false;

      // A deferred "tell the server we left" timer — armed by an unexpected drop, cancelled if a
      // force-move (or a fresh join) arrives inside the grace window. See MOVE_GRACE_MS.
      let pendingLeaveTimer: ReturnType<typeof setTimeout> | null = null;
      const clearPendingLeave = (): void => {
        if (pendingLeaveTimer) {
          clearTimeout(pendingLeaveTimer);
          pendingLeaveTimer = null;
        }
      };

      /**
       * Handles an UNEXPECTED media drop (network loss, server close, or a moderator force-move
       * kicking us from the old LiveKit room). Resets local state immediately, but DEFERS the
       * server leave so an incoming VoiceForceMoved can cancel it — see MOVE_GRACE_MS.
       */
      const handleUnexpectedDrop = (channelId: string): void => {
        reset(channelId);
        clearPendingLeave();
        pendingLeaveTimer = setTimeout(() => {
          pendingLeaveTimer = null;
          void signalR.leaveVoice(channelId);
        }, MOVE_GRACE_MS);
      };

      return {
        participantsOf(channelId: string): VoiceParticipant[] {
          return store.participantsByChannel()[channelId] ?? [];
        },

        /**
         * Seeds a channel's roster from REST *without* joining — lets a DM view surface an ongoing
         * call you haven't answered (the channel group's live deltas keep it fresh afterwards).
         */
        async loadRoster(channelId: string): Promise<void> {
          try {
            const roster = await voice.getParticipants(channelId);
            patchState(store, {
              participantsByChannel: { ...store.participantsByChannel(), [channelId]: roster },
            });
          } catch {
            // fail open — keep whatever the gateway has delivered
          }
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
            // before disconnecting) — reset + a deferred server-leave so a racing force-move wins.
            await voice.connect(
              channelId,
              () => handleUnexpectedDrop(channelId),
              bitrateOf(channelId),
            );
            // Cancelled during the media connect (cancelJoin nulled the pending channel + already
            // tore the media down) — bail before we signal a join we're abandoning.
            if (store.connectingChannelId() !== channelId) {
              await voice.disconnect().catch(() => {});
              return;
            }
            await signalR.joinVoice(channelId);
            // Cancelled during signaling — retract the join we just sent, then bail.
            if (store.connectingChannelId() !== channelId) {
              void signalR.leaveVoice(channelId).catch(() => {});
              await voice.disconnect().catch(() => {});
              return;
            }
            clearPendingLeave(); // a completed (re)join supersedes any deferred leave
            // Go "connected" immediately with an optimistic self entry — do NOT block the UI on the
            // getParticipants round trip. loadRoster reconciles the existing occupants right after,
            // and the live gateway deltas keep it fresh from there.
            patchState(store, {
              activeChannelId: channelId,
              lastRoomChannelId: channelId,
              connecting: false,
              connectingChannelId: null,
              mediaSuspended: false,
              selfMuted: false,
              selfDeafened: false,
              selfVideoOn: false,
              selfStreaming: false,
              participantsByChannel: upsert(store.participantsByChannel(), selfParticipant(channelId)),
            });
            void this.loadRoster(channelId);
          } catch (err) {
            console.error('[voice] join failed', err);
            await voice.disconnect().catch(() => {});
            patchState(store, { connecting: false, connectingChannelId: null });
          }
        },

        /**
         * Cancels an in-flight join (the "Connecting…" state) — clears the pending flags and tears
         * the media down. The pending join sees `connectingChannelId` change and bails at its next
         * checkpoint (retracting the JoinVoice if it already went out).
         */
        async cancelJoin(): Promise<void> {
          if (!store.connecting()) return;
          clearPendingLeave();
          patchState(store, { connecting: false, connectingChannelId: null, lastRoomChannelId: null });
          await voice.disconnect().catch(() => {});
        },

        /** Leaves the active voice channel (media + signaling) and clears local voice state. */
        async leave(): Promise<void> {
          // Still connecting? There's no room to leave — cancel the in-flight join instead.
          if (store.connecting()) {
            await this.cancelJoin();
            return;
          }
          const channelId = store.activeChannelId();
          if (!channelId) return;
          clearPendingLeave();
          patchState(store, { lastRoomChannelId: null });
          reset(channelId);
          await signalR.leaveVoice(channelId);
          await voice.disconnect().catch(() => {});
        },

        /**
         * A moderator moved us to another voice channel — reconnect media to the destination. Robust
         * to the server's LiveKit kick racing ahead of the VoiceForceMoved signal: cancels any
         * deferred leave (so the destination state we were just given isn't wiped) and rejoins even
         * if the racing drop already cleared our active channel.
         */
        async followForceMove(toChannelId: string): Promise<void> {
          clearPendingLeave();
          if (store.activeChannelId() === toChannelId) return; // already reconnected
          patchState(store, { activeChannelId: null });
          await this.join(toChannelId);
        },

        /**
         * Silently drops the LiveKit room while ALONE in a guild voice channel (fired by the
         * alone-timer in onInit). Signaling is untouched — the server, everyone else's sidebar,
         * and our own UI all keep showing us connected; the first VoiceParticipantJoined (or a
         * local camera/screenshare action) resumes media via {@link resumeMedia}.
         */
        suspendMedia(): void {
          if (!store.activeChannelId() || store.mediaSuspended() || store.connecting()) return;
          patchState(store, { mediaSuspended: true });
          // A local disconnect (onEnded nulled) — handleUnexpectedDrop can't fire off this.
          void voice.disconnect().catch(() => {});
        },

        /**
         * Reconnects the media room after an alone-suspension. The roster/server never changed,
         * so this is LiveKit-only: fresh token + connect, then re-assert the mute/deafen state
         * the user's toggles still show (connect() enables the mic by default).
         */
        async resumeMedia(): Promise<void> {
          const channelId = store.activeChannelId();
          if (!channelId || !store.mediaSuspended() || resumingMedia) return;
          resumingMedia = true;
          try {
            await voice.connect(
              channelId,
              () => handleUnexpectedDrop(channelId),
              bitrateOf(channelId),
            );
            patchState(store, { mediaSuspended: false });
            voice.setMicMuted(store.selfMuted() || store.selfServerMuted());
            voice.setDeafened(store.selfDeafened() || store.selfServerDeafened());
          } catch (err) {
            console.error('[voice] media resume failed', err);
            // Media can't come back (network/token failure) — leave for real rather than haunt
            // the roster deaf and mute. Skip if a leave/evict already tore us down mid-resume.
            if (store.activeChannelId() === channelId && store.mediaSuspended()) {
              patchState(store, { lastRoomChannelId: null });
              reset(channelId);
              void signalR.leaveVoice(channelId).catch(() => {});
            }
          } finally {
            resumingMedia = false;
          }
        },

        /** Toggles the mic. Unmuting while deafened also undeafens (Discord behavior).
         *  Locked while server-muted — only a moderator can lift a server mute. */
        toggleMute(): void {
          const channelId = store.activeChannelId();
          if (!channelId || store.selfServerMuted()) return;
          const muted = !store.selfMuted();
          const deafened = muted ? store.selfDeafened() : false; // unmute clears deafen
          patchState(store, { selfMuted: muted, selfDeafened: deafened });
          voice.setMicMuted(muted);
          voice.setDeafened(deafened);
          patchSelf(channelId, { isMuted: muted, isDeafened: deafened });
          broadcastSelfState();
        },

        /** Toggles deafen. Deafening also mutes the mic; undeafening unmutes it (Discord behavior).
         *  Locked while server-deafened — only a moderator can lift a server deafen. */
        toggleDeafen(): void {
          const channelId = store.activeChannelId();
          if (!channelId || store.selfServerDeafened()) return;
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
          if (store.mediaSuspended()) await this.resumeMedia(); // publishing needs a live room
          const channelId = store.activeChannelId();
          if (!channelId) return;
          const on = await voice.setCameraEnabled(!store.selfVideoOn());
          patchState(store, { selfVideoOn: on });
          patchSelf(channelId, { isVideoOn: on });
          broadcastSelfState();
        },

        /** Toggles screensharing. Cancelling the browser's picker resolves back to "off" silently. */
        async toggleScreenShare(): Promise<void> {
          if (store.mediaSuspended()) await this.resumeMedia(); // publishing needs a live room
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

        // --- click-to-watch streams + hide-video-for-me (local viewer preferences) ---
        isWatchingStream(userId: string): boolean {
          return store.watchedStreamUserIds().includes(userId);
        },

        toggleWatchStream(userId: string): void {
          const watched = store.watchedStreamUserIds();
          patchState(store, {
            watchedStreamUserIds: watched.includes(userId)
              ? watched.filter((id) => id !== userId)
              : [...watched, userId],
          });
        },

        isVideoHidden(userId: string): boolean {
          return store.hiddenVideoUserIds().includes(userId);
        },

        toggleHideVideo(userId: string): void {
          const hidden = store.hiddenVideoUserIds();
          patchState(store, {
            hiddenVideoUserIds: hidden.includes(userId)
              ? hidden.filter((id) => id !== userId)
              : [...hidden, userId],
          });
        },

        // --- voice moderation (MuteMembers / DeafenMembers / MoveMembers — server-gated). These
        //     rethrow so menu actions can toast a permission rejection; the roster updates via the
        //     VoiceStateUpdated / Left+Joined echoes, nothing is patched optimistically. ---
        async serverMute(targetUserId: string, mute: boolean): Promise<void> {
          await signalR.moderateVoiceState(targetUserId, mute, null);
        },

        async serverDeafen(targetUserId: string, deafen: boolean): Promise<void> {
          await signalR.moderateVoiceState(targetUserId, null, deafen);
        },

        async moveParticipant(targetUserId: string, toChannelId: string): Promise<void> {
          await signalR.moveVoiceParticipant(targetUserId, toChannelId);
        },

        // --- gateway handlers (own-state mutation for the live roster) ---
        applyJoined(p: VoiceParticipant): void {
          patchState(store, { participantsByChannel: upsert(store.participantsByChannel(), p) });
          // First joiner while our media is alone-suspended → reconnect transparently.
          if (
            store.mediaSuspended() &&
            p.channelId === store.activeChannelId() &&
            p.userId !== myId()
          ) {
            void this.resumeMedia();
          }
        },

        applyStateUpdated(p: VoiceParticipant): void {
          const prev = (store.participantsByChannel()[p.channelId] ?? []).find(
            (x) => x.userId === p.userId,
          );
          patchState(store, { participantsByChannel: upsert(store.participantsByChannel(), p) });
          // A stream that ended revokes its watch opt-in — restarting it needs a fresh click.
          if (!p.isStreaming && store.watchedStreamUserIds().includes(p.userId)) {
            patchState(store, {
              watchedStreamUserIds: store.watchedStreamUserIds().filter((id) => id !== p.userId),
            });
          }
          // Sync own flags from the echo: the hub clamps unauthorized video/stream flags, so a
          // server-adjusted state must snap the local toggles back too.
          if (p.userId === myId() && p.channelId === store.activeChannelId()) {
            patchState(store, {
              selfMuted: p.isMuted,
              selfDeafened: p.isDeafened,
              selfVideoOn: p.isVideoOn,
              selfStreaming: p.isStreaming,
            });
            // Comply with a server mute/deafen in the media layer too (belt to LiveKit's braces),
            // and restore mic/audio when a moderator lifts it — unless self-muted underneath.
            if (prev && prev.isServerMuted !== p.isServerMuted) {
              voice.setMicMuted(p.isServerMuted || p.isMuted);
            }
            if (prev && prev.isServerDeafened !== p.isServerDeafened) {
              voice.setDeafened(p.isServerDeafened || p.isDeafened);
            }
          }
        },

        applyLeft(channelId: string, userId: string): void {
          // If the server evicted *us* (e.g. we joined voice on another device), tear down locally.
          if (userId === myId() && channelId === store.activeChannelId()) {
            clearPendingLeave();
            patchState(store, { lastRoomChannelId: null });
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
          case 'VoiceForceMoved':
            // A moderator moved us — reconnect media to the destination. Only the tab that held the
            // source room acts (the event reaches every tab of the user): either still connected to
            // it, OR just kicked out of it by the server's LiveKit removal racing ahead of this
            // event (hence the lastRoomChannelId fallback). followForceMove handles both orderings.
            if (
              store.activeChannelId() === e.payload.fromChannelId ||
              store.lastRoomChannelId() === e.payload.fromChannelId
            ) {
              void store.followForceMove(e.payload.toChannelId);
            }
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

      // Mirror the click-to-watch set into the media layer: stream AUDIO stays subscribed only
      // for streams this viewer is actually watching (Discord-style — and no wasted download).
      effect(() => {
        voice.syncWatchedStreams(new Set(store.watchedStreamUserIds()));
      });

      // Alone in a guild voice channel → after SUSPEND_WHEN_ALONE_MS, silently drop the media
      // room (suspendMedia — nobody, including us, sees a change) and let the first joiner
      // resume it. Camera/screenshare keep the room alive: a killed screenshare can't be
      // restored without a fresh browser picker, and dynacast already pauses unwatched video
      // uploads anyway. DM calls (guildId null) are exempt — CallStore fully auto-leaves those.
      let suspendTimer: ReturnType<typeof setTimeout> | null = null;
      effect(() => {
        const channelId = store.activeChannelId();
        const roster = channelId ? (store.participantsByChannel()[channelId] ?? []) : [];
        const aloneInGuildVoice =
          !!channelId &&
          !store.connecting() &&
          !store.mediaSuspended() &&
          !store.selfVideoOn() &&
          !store.selfStreaming() &&
          roster.length === 1 &&
          roster[0].guildId !== null;
        if (aloneInGuildVoice) {
          suspendTimer ??= setTimeout(() => {
            suspendTimer = null;
            store.suspendMedia();
          }, SUSPEND_WHEN_ALONE_MS);
        } else if (suspendTimer) {
          clearTimeout(suspendTimer);
          suspendTimer = null;
        }
      });
    },
  }),
);
