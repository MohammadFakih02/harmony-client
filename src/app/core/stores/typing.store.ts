import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { GatewayEvents } from '../hub/gateway-events';
import { AuthService } from '../services/auth.service';

interface TypingState {
  // channelId → userIds currently shown as typing.
  byChannel: Record<string, string[]>;
}

/**
 * Server sends only a `TypingStarted` (throttled ~every 3s while a user types) with no reliable
 * "stopped" for every case (a user can walk away). So each typer is kept alive by a short timer that
 * clears them if no further signal arrives; a fresh `TypingStarted` resets it. An explicit
 * `TypingStopped` (on send) or the arrival of the user's message clears them immediately.
 */
const TYPING_TTL_MS = 6000;

export const TypingStore = signalStore(
  { providedIn: 'root' },
  withState<TypingState>({ byChannel: {} }),
  withMethods((store, auth = inject(AuthService)) => {
    // Per (channel,user) expiry timers — plain state, not reactive.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const key = (channelId: string, userId: string) => `${channelId}:${userId}`;

    const remove = (channelId: string, userId: string): void => {
      const t = timers.get(key(channelId, userId));
      if (t) {
        clearTimeout(t);
        timers.delete(key(channelId, userId));
      }
      const list = store.byChannel()[channelId];
      if (!list || !list.includes(userId)) return;
      patchState(store, {
        byChannel: { ...store.byChannel(), [channelId]: list.filter((u) => u !== userId) },
      });
    };

    return {
      /** User ids currently typing in a channel (never includes the current user). */
      typersOf(channelId: string): string[] {
        return store.byChannel()[channelId] ?? [];
      },

      /** A user started/continued typing — add them and (re)arm their expiry timer. Ignores self. */
      applyStarted(channelId: string, userId: string): void {
        if (userId === auth.currentUser()?.id) return;

        const existing = timers.get(key(channelId, userId));
        if (existing) clearTimeout(existing);
        timers.set(
          key(channelId, userId),
          setTimeout(() => remove(channelId, userId), TYPING_TTL_MS),
        );

        const list = store.byChannel()[channelId] ?? [];
        if (list.includes(userId)) return; // already shown — the reset timer above is enough
        patchState(store, { byChannel: { ...store.byChannel(), [channelId]: [...list, userId] } });
      },

      /** A user stopped typing (sent, or their message arrived) — clear them immediately. */
      applyStopped(channelId: string, userId: string): void {
        remove(channelId, userId);
      },
    };
  }),
  withHooks({
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'TypingStarted':
            store.applyStarted(e.payload.channelId, e.payload.userId);
            break;
          case 'TypingStopped':
            store.applyStopped(e.payload.channelId, e.payload.userId);
            break;
          case 'MessageReceived':
            // The message landed — the sender is no longer "typing", clear them at once.
            store.applyStopped(e.message.channelId, e.message.userId);
            break;
        }
      });
    },
  }),
);
