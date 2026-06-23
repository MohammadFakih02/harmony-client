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
  statusMessages: Record<string, string | null>; // userId → custom status text (others' view)
  myStatus: string; // the current user's displayed status (drives the user-deck dot)
  myStatusMessage: string | null; // the current user's custom status text
}

/** Invisible is masked to offline; every other status is its own effective value. */
function effectiveOf(status: string): string {
  return status === 'invisible' ? 'offline' : status;
}

export const PresenceStore = signalStore(
  { providedIn: 'root' },
  withState<PresenceState>({
    statuses: {},
    statusMessages: {},
    myStatus: 'offline',
    myStatusMessage: null,
  }),
  withMethods((store, presence = inject(PresenceService), auth = inject(AuthService)) => ({
    /** Reads presence (status + custom message) for a set of users and merges it in. */
    async loadStatuses(userIds: string[]): Promise<void> {
      if (userIds.length === 0) return;
      try {
        const fetched = await presence.getStatuses(userIds);
        const statuses: Record<string, string> = {};
        const messages: Record<string, string | null> = {};
        for (const [id, p] of Object.entries(fetched)) {
          statuses[id] = p.status;
          messages[id] = p.statusMessage;
        }
        patchState(store, {
          statuses: { ...store.statuses(), ...statuses },
          statusMessages: { ...store.statusMessages(), ...messages },
        });
      } catch {
        // Fail open — absent statuses simply render as offline.
      }
    },

    /** Current effective status for a user; defaults to offline. */
    statusOf(userId: string): string {
      return store.statuses()[userId] ?? 'offline';
    },

    /** Current custom status message for a user, or null. */
    statusMessageOf(userId: string): string | null {
      return store.statusMessages()[userId] ?? null;
    },

    applyOnline(p: OnlineStatusPayload): void {
      patchState(store, { statuses: { ...store.statuses(), [p.userId]: p.status } });
    },

    applyOffline(p: OfflineStatusPayload): void {
      // An offline user shows no custom status.
      patchState(store, {
        statuses: { ...store.statuses(), [p.userId]: 'offline' },
        statusMessages: { ...store.statusMessages(), [p.userId]: null },
      });
    },

    applyStatusChanged(p: StatusChangedPayload): void {
      const myId = auth.currentUser()?.id;
      if (p.userId === myId) {
        // Self broadcast carries the raw preferred value — keep our own dot in sync.
        patchState(store, {
          myStatus: p.status,
          myStatusMessage: p.statusMessage,
          statuses: { ...store.statuses(), [p.userId]: effectiveOf(p.status) },
          statusMessages: { ...store.statusMessages(), [p.userId]: p.statusMessage },
        });
      } else {
        patchState(store, {
          statuses: { ...store.statuses(), [p.userId]: p.status },
          statusMessages: { ...store.statusMessages(), [p.userId]: p.statusMessage },
        });
      }
    },

    /** Loads the current user's durable preferred status + custom message on startup. */
    async initMyStatus(): Promise<void> {
      try {
        const profile = await presence.getMyProfile();
        patchState(store, {
          myStatus: profile.preferredStatus,
          myStatusMessage: profile.statusMessage,
        });
      } catch {
        patchState(store, { myStatus: 'online' });
      }
    },

    /**
     * Optimistically updates and persists the preferred status. `expiresInMinutes`
     * auto-reverts it to online server-side after that many minutes (null = never).
     */
    async setMyStatus(status: PreferredStatus, expiresInMinutes: number | null = null): Promise<void> {
      const previous = store.myStatus();
      const myId = auth.currentUser()?.id;
      patchState(store, {
        myStatus: status,
        ...(myId
          ? { statuses: { ...store.statuses(), [myId]: effectiveOf(status) } }
          : {}),
      });
      try {
        await presence.setMyStatus(status, expiresInMinutes);
      } catch {
        patchState(store, { myStatus: previous }); // revert on failure
      }
    },

    /** Optimistically updates and persists the custom status message (null clears it). */
    async setCustomStatus(message: string | null, expiresInMinutes: number | null = null): Promise<void> {
      const previous = store.myStatusMessage();
      const next = message && message.trim() ? message.trim() : null;
      patchState(store, { myStatusMessage: next });
      try {
        await presence.setCustomStatus(next, expiresInMinutes);
      } catch {
        patchState(store, { myStatusMessage: previous }); // revert on failure
      }
    },
  })),
);
