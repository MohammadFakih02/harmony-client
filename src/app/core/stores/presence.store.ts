import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { AuthService } from '../services/auth.service';
import { PresenceService } from '../services/presence.service';
import { GatewayEvents } from '../hub/gateway-events';
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
  myStatusExpiresAt: number | null; // unix-ms the preferred status auto-reverts to online
  myStatusMessageExpiresAt: number | null; // unix-ms the custom message auto-clears
}

/** Converts an "auto-clear after N minutes" choice into an absolute unix-ms timestamp. */
function expiryFromMinutes(minutes: number | null): number | null {
  return minutes != null ? Date.now() + minutes * 60_000 : null;
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
    myStatusExpiresAt: null,
    myStatusMessageExpiresAt: null,
  }),
  withMethods((store, presence = inject(PresenceService), auth = inject(AuthService)) => {
    // Ids already fetched (or in flight) — repeat loadStatuses calls with the same members
    // (member-sidebar effect re-runs, /friends revisits) skip the round trip; live changes
    // arrive via gateway events. `force: true` bypasses this (socket-recovery reconcile).
    const requested = new Set<string>();

    return {
    /**
     * Reads presence (status + custom message) for a set of users and merges it in.
     * Deduped: ids already fetched or in flight are skipped unless `force` is set.
     */
    async loadStatuses(userIds: string[], opts?: { force?: boolean }): Promise<void> {
      const ids = opts?.force ? userIds : userIds.filter((id) => !requested.has(id));
      if (ids.length === 0) return;
      for (const id of ids) requested.add(id);
      try {
        const fetched = await presence.getStatuses(ids);
        const statuses: Record<string, string> = {};
        const messages: Record<string, string | null> = {};
        for (const [id, p] of Object.entries(fetched)) {
          statuses[id] = p.status;
          messages[id] = p.statusMessage;
        }
        // The current user knows their own status better than a momentary server read: a
        // just-connected user whose Redis status key isn't set yet comes back 'offline' and
        // would clobber our own dot. Once initMyStatus has resolved (myStatus != 'offline'),
        // keep our own known effective status.
        const myId = auth.currentUser()?.id;
        if (myId && store.myStatus() !== 'offline') {
          statuses[myId] = effectiveOf(store.myStatus());
        }
        patchState(store, {
          statuses: { ...store.statuses(), ...statuses },
          statusMessages: { ...store.statusMessages(), ...messages },
        });
      } catch {
        // Fail open — absent statuses simply render as offline. Un-mark the ids so a
        // later call can retry the fetch.
        for (const id of ids) requested.delete(id);
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
      // Carries the custom status text so a friend coming online shows it without a reload.
      patchState(store, {
        statuses: { ...store.statuses(), [p.userId]: p.status },
        statusMessages: { ...store.statusMessages(), [p.userId]: p.statusMessage },
      });
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
        // The payload has no expiry field, so only clear the locally-tracked expiries when
        // the status/message has actually gone (reverted to online / message cleared) —
        // never on an echo of our own just-set expiring status (which would wipe it).
        patchState(store, {
          myStatus: p.status,
          myStatusMessage: p.statusMessage,
          myStatusExpiresAt: p.status === 'online' ? null : store.myStatusExpiresAt(),
          myStatusMessageExpiresAt: p.statusMessage ? store.myStatusMessageExpiresAt() : null,
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

    /**
     * Applies my durable profile (preferred status + custom message + expiries) — from the
     * bootstrap payload or the /me fallback fetch. Also seeds my own effective status into the
     * dot map so the member sidebar shows me online from the start, rather than defaulting to
     * offline until my next change.
     */
    applyMyProfile(profile: {
      preferredStatus: string;
      statusMessage: string | null;
      preferredStatusExpiresAt: number | null;
      statusMessageExpiresAt: number | null;
    }): void {
      const myId = auth.currentUser()?.id;
      patchState(store, {
        myStatus: profile.preferredStatus,
        myStatusMessage: profile.statusMessage,
        myStatusExpiresAt: profile.preferredStatusExpiresAt,
        myStatusMessageExpiresAt: profile.statusMessageExpiresAt,
        ...(myId
          ? { statuses: { ...store.statuses(), [myId]: effectiveOf(profile.preferredStatus) } }
          : {}),
      });
    },

    /** Loads the current user's durable preferred status + custom message on startup. */
    async initMyStatus(): Promise<void> {
      try {
        this.applyMyProfile(await presence.getMyProfile());
      } catch {
        const myId = auth.currentUser()?.id;
        patchState(store, {
          myStatus: 'online',
          ...(myId ? { statuses: { ...store.statuses(), [myId]: 'online' } } : {}),
        });
      }
    },

    /**
     * Optimistically updates and persists the preferred status. `expiresInMinutes`
     * auto-reverts it to online server-side after that many minutes (null = never).
     */
    async setMyStatus(status: PreferredStatus, expiresInMinutes: number | null = null): Promise<void> {
      const previous = store.myStatus();
      const previousExpiry = store.myStatusExpiresAt();
      const myId = auth.currentUser()?.id;
      // Online is the revert target, so it never carries an expiry.
      const expiresAt = status === 'online' ? null : expiryFromMinutes(expiresInMinutes);
      patchState(store, {
        myStatus: status,
        myStatusExpiresAt: expiresAt,
        ...(myId
          ? { statuses: { ...store.statuses(), [myId]: effectiveOf(status) } }
          : {}),
      });
      try {
        await presence.setMyStatus(status, expiresInMinutes);
      } catch {
        patchState(store, { myStatus: previous, myStatusExpiresAt: previousExpiry }); // revert on failure
      }
    },

    /** Optimistically updates and persists the custom status message (null clears it). */
    async setCustomStatus(message: string | null, expiresInMinutes: number | null = null): Promise<void> {
      const previous = store.myStatusMessage();
      const previousExpiry = store.myStatusMessageExpiresAt();
      const next = message && message.trim() ? message.trim() : null;
      // No message → no expiry to track.
      const expiresAt = next ? expiryFromMinutes(expiresInMinutes) : null;
      patchState(store, { myStatusMessage: next, myStatusMessageExpiresAt: expiresAt });
      try {
        await presence.setCustomStatus(next, expiresInMinutes);
      } catch {
        // revert on failure
        patchState(store, { myStatusMessage: previous, myStatusMessageExpiresAt: previousExpiry });
      }
    },
    };
  }),
  withHooks({
    // Own presence events off the gateway stream (self-status sync + others' member-list dots).
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'OnlineStatus':
            store.applyOnline(e.payload);
            break;
          case 'OfflineStatus':
            store.applyOffline(e.payload);
            break;
          case 'StatusChanged':
            store.applyStatusChanged(e.payload);
            break;
        }
      });
    },
  }),
);
