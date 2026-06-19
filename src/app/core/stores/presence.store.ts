import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { AuthService } from '../services/auth.service';
import { PresenceService } from '../services/presence.service';
import {
  OfflineStatusPayload,
  OnlineStatusPayload,
  PreferredStatus,
  StatusChangedPayload,
} from '../models/presence.models';

interface PresenceState {
  statuses: Record<string, string>; // userId → public effective status (others' view)
  myStatus: string; // the current user's displayed status (drives the user-deck dot)
}

/** Invisible is masked to offline; every other status is its own effective value. */
function effectiveOf(status: string): string {
  return status === 'invisible' ? 'offline' : status;
}

export const PresenceStore = signalStore(
  { providedIn: 'root' },
  withState<PresenceState>({ statuses: {}, myStatus: 'offline' }),
  withMethods((store, presence = inject(PresenceService), auth = inject(AuthService)) => ({
    /** Reads several users' effective statuses (e.g. when a member list loads) and merges them. */
    async loadStatuses(userIds: string[]): Promise<void> {
      if (userIds.length === 0) return;
      try {
        const fetched = await presence.getStatuses(userIds);
        patchState(store, { statuses: { ...store.statuses(), ...fetched } });
      } catch {
        // Fail open — absent statuses simply render as offline.
      }
    },

    /** Current effective status for a user; defaults to offline. */
    statusOf(userId: string): string {
      return store.statuses()[userId] ?? 'offline';
    },

    applyOnline(p: OnlineStatusPayload): void {
      patchState(store, { statuses: { ...store.statuses(), [p.userId]: p.status } });
    },

    applyOffline(p: OfflineStatusPayload): void {
      patchState(store, { statuses: { ...store.statuses(), [p.userId]: 'offline' } });
    },

    applyStatusChanged(p: StatusChangedPayload): void {
      const myId = auth.currentUser()?.id;
      if (p.userId === myId) {
        // Self broadcast carries the raw preferred value — keep our own dot in sync.
        patchState(store, {
          myStatus: p.status,
          statuses: { ...store.statuses(), [p.userId]: effectiveOf(p.status) },
        });
      } else {
        patchState(store, { statuses: { ...store.statuses(), [p.userId]: p.status } });
      }
    },

    /** Loads the current user's durable preferred status on startup. */
    async initMyStatus(): Promise<void> {
      try {
        patchState(store, { myStatus: await presence.getMyPreferredStatus() });
      } catch {
        patchState(store, { myStatus: 'online' });
      }
    },

    /** Optimistically updates and persists the current user's preferred status. */
    async setMyStatus(status: PreferredStatus): Promise<void> {
      const previous = store.myStatus();
      const myId = auth.currentUser()?.id;
      patchState(store, {
        myStatus: status,
        ...(myId
          ? { statuses: { ...store.statuses(), [myId]: effectiveOf(status) } }
          : {}),
      });
      try {
        await presence.setMyStatus(status);
      } catch {
        patchState(store, { myStatus: previous }); // revert on failure
      }
    },
  })),
);
