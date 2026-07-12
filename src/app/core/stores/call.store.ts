import { effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { GatewayEvents } from '../hub/gateway-events';
import { SignalRService } from '../services/signalr.service';
import { RingtoneService } from '../services/ringtone.service';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth.service';
import { DmStore } from './dm.store';
import { VoiceStore } from './voice.store';
import { IncomingCallPayload, VoiceParticipant } from '../models/voice.models';

/** Client-side ring window — both sides give up after this; the server's 75s key TTL backstops. */
const RING_TIMEOUT_MS = 60_000;

interface CallState {
  /** The ring being shown to us (first ring wins while one is up). */
  incoming: IncomingCallPayload | null;
  /** The ring we sent out and are waiting on (we're already in the voice room). */
  outgoing: { channelId: string } | null;
}

/**
 * DM/group-DM call ringing (LiveKit Slice 4). Owns the ring lifecycle on both sides — the incoming
 * modal state, the outgoing wait, the ringtones, and the 60s timeouts — composing {@link VoiceStore}
 * for the actual room membership (roster/media stay untouched there). Root-provided and
 * gateway-subscribed from boot (injected in the shell) so a ring reaches you anywhere in the app.
 */
export const CallStore = signalStore(
  { providedIn: 'root' },
  withState<CallState>({ incoming: null, outgoing: null }),
  withMethods(
    (
      store,
      voiceStore = inject(VoiceStore),
      signalR = inject(SignalRService),
      ringtone = inject(RingtoneService),
      toast = inject(ToastService),
      dmStore = inject(DmStore),
      auth = inject(AuthService),
    ) => {
      const myId = () => auth.currentUser()?.id ?? null;

      let incomingTimer: ReturnType<typeof setTimeout> | null = null;
      let outgoingTimer: ReturnType<typeof setTimeout> | null = null;

      /** One audio element serves both sides — incoming takes precedence when both ring. */
      const syncRingtone = (): void => {
        if (store.incoming()) ringtone.playIncoming();
        else if (store.outgoing()) ringtone.playOutgoing();
        else ringtone.stop();
      };

      const clearIncoming = (): void => {
        if (incomingTimer) {
          clearTimeout(incomingTimer);
          incomingTimer = null;
        }
        if (!store.incoming()) return;
        patchState(store, { incoming: null });
        syncRingtone();
      };

      const clearOutgoing = (): void => {
        if (outgoingTimer) {
          clearTimeout(outgoingTimer);
          outgoingTimer = null;
        }
        if (!store.outgoing()) return;
        patchState(store, { outgoing: null });
        syncRingtone();
      };

      return {
        /**
         * Joins the DM's voice room, then rings the other participants. A StartCall rejection is
         * swallowed on purpose: the main cause is the occupied-room race, where losing just means
         * you joined an already-live call — exactly what you wanted.
         */
        async startCall(channelId: string): Promise<void> {
          await voiceStore.join(channelId);
          if (voiceStore.activeChannelId() !== channelId) return; // join failed — nothing to ring
          try {
            await signalR.startCall(channelId);
          } catch {
            return; // ring didn't go out; we're simply in the call
          }
          patchState(store, { outgoing: { channelId } });
          syncRingtone();
          outgoingTimer = setTimeout(() => {
            // Nobody answered: clear first so the leave-effect doesn't double-cancel.
            clearOutgoing();
            signalR.cancelCall(channelId, true);
            void voiceStore.leave();
          }, RING_TIMEOUT_MS);
        },

        /** Answers the incoming ring — joins the room; the modal handles navigation. */
        async accept(): Promise<void> {
          const ring = store.incoming();
          if (!ring) return;
          clearIncoming();
          await voiceStore.join(ring.channelId);
        },

        /** Declines the incoming ring (a 1:1 caller auto-hangs-up on the CallDeclined). */
        decline(): void {
          const ring = store.incoming();
          if (!ring) return;
          signalR.declineCall(ring.channelId);
          clearIncoming();
        },

        /** Ignores the ring locally (✕) — no signal; the caller's side times out naturally. */
        dismiss(): void {
          clearIncoming();
        },

        // --- gateway handlers ---

        applyIncomingCall(p: IncomingCallPayload): void {
          if (p.callerId === myId()) return; // own ring echoed to another tab
          if (store.incoming()) return; // first ring wins
          if (voiceStore.activeChannelId() === p.channelId) return; // already in that call
          patchState(store, { incoming: p });
          syncRingtone();
          incomingTimer = setTimeout(() => clearIncoming(), RING_TIMEOUT_MS);
        },

        applyCallCancelled(channelId: string): void {
          if (store.incoming()?.channelId === channelId) clearIncoming();
        },

        applyCallDeclined(channelId: string, userId: string): void {
          if (store.outgoing()?.channelId !== channelId) return;
          const dm = dmStore.find(channelId);
          const name =
            dm?.participants.find((p) => p.userId === userId)?.username ?? 'Someone';
          toast.info(`${name} declined the call`, 'fa-phone-slash');
          // 1:1: the only callee said no — hang up. Group: the others keep ringing.
          if (!dm || !dm.isGroup) {
            clearOutgoing();
            signalR.cancelCall(channelId, false);
            void voiceStore.leave();
          }
        },

        applyVoiceJoined(p: VoiceParticipant): void {
          // We answered on another tab/device → drop this tab's modal.
          if (p.userId === myId() && store.incoming()?.channelId === p.channelId) {
            clearIncoming();
          }
          // Someone picked up our ring → stop waiting, we're just in the call now.
          if (p.userId !== myId() && store.outgoing()?.channelId === p.channelId) {
            clearOutgoing();
          }
        },

        applyVoiceLeft(channelId: string): void {
          // The ringing room emptied out (caller crashed or hung up before CancelCall landed).
          if (
            store.incoming()?.channelId === channelId &&
            voiceStore.participantsOf(channelId).length === 0
          ) {
            clearIncoming();
          }
        },

        /** Any leave path (voice bar, stage, overlay) while still ringing = a missed-call cancel. */
        hangUpWhileRinging(): void {
          const ring = store.outgoing();
          if (!ring) return;
          clearOutgoing();
          signalR.cancelCall(ring.channelId, true);
        },
      };
    },
  ),
  withHooks({
    onInit(store, gateway = inject(GatewayEvents), voiceStore = inject(VoiceStore)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'IncomingCall':
            store.applyIncomingCall(e.payload);
            break;
          case 'CallCancelled':
            store.applyCallCancelled(e.payload.channelId);
            break;
          case 'CallDeclined':
            store.applyCallDeclined(e.payload.channelId, e.payload.userId);
            break;
          case 'VoiceParticipantJoined':
            store.applyVoiceJoined(e.payload);
            break;
          case 'VoiceParticipantLeft':
            store.applyVoiceLeft(e.payload.channelId);
            break;
        }
      });

      // Leaving the room by ANY path while the ring is still out (disconnect button, another
      // join evicting us…) counts as hanging up — cancel with missed=true without every leave
      // path having to know about ringing.
      effect(() => {
        if (store.outgoing() && !voiceStore.inVoice()) store.hangUpWhileRinging();
      });
    },
  }),
);
