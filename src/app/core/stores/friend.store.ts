import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { Friend, FriendRemovedPayload, FriendUserPayload, PendingFriend } from '../models/friend.models';
import { FriendService } from '../services/friend.service';
import { GatewayEvents } from '../hub/gateway-events';
import { NotificationStore } from './notification.store';

interface FriendState {
  friends: Friend[];
  pending: PendingFriend[];
  loading: boolean;
}

export const FriendStore = signalStore(
  { providedIn: 'root' },
  withState<FriendState>({ friends: [], pending: [], loading: false }),
  withComputed(({ friends, pending }) => ({
    incoming: computed(() => pending().filter((p) => p.direction === 'incoming')),
    outgoing: computed(() => pending().filter((p) => p.direction === 'outgoing')),
    incomingCount: computed(() => pending().filter((p) => p.direction === 'incoming').length),
    friendCount: computed(() => friends().length),
  })),
  withMethods((store, service = inject(FriendService), notifications = inject(NotificationStore)) => {
    const reload = async (): Promise<void> => {
      const [friends, pending] = await Promise.all([service.getFriends(), service.getPending()]);
      patchState(store, { friends, pending });
    };

    return {
      /** Distributes the bootstrap payload's friend snapshot (no fetch). */
      set(friends: Friend[], pending: PendingFriend[]): void {
        patchState(store, { friends, pending });
      },

      async load(): Promise<void> {
        patchState(store, { loading: true });
        try {
          await reload();
        } finally {
          patchState(store, { loading: false });
        }
      },

      /** Sends a request by username; reloads since the server may have auto-accepted it. */
      async sendRequest(username: string): Promise<void> {
        await service.sendRequest(username);
        await reload();
      },

      async accept(requesterId: string): Promise<void> {
        await service.accept(requesterId);
        // Accepting the request is "viewing the cause" — clear its notification.
        notifications.markFriendRequestRead(requesterId);
        await reload();
      },

      /** Decline / cancel / unfriend — optimistic local removal. */
      async remove(userId: string): Promise<void> {
        patchState(store, {
          friends: store.friends().filter((f) => f.id !== userId),
          pending: store.pending().filter((p) => p.id !== userId),
        });
        await service.remove(userId).catch(() => {});
      },

      // --- SignalR-driven ---

      applyFriendRequest(p: FriendUserPayload): void {
        if (store.pending().some((x) => x.id === p.id)) return;
        patchState(store, {
          pending: [
            { ...p, direction: 'incoming' as const, createdAt: Date.now() },
            ...store.pending(),
          ],
        });
      },

      applyFriendAccepted(p: FriendUserPayload): void {
        patchState(store, {
          pending: store.pending().filter((x) => x.id !== p.id),
          friends: store.friends().some((f) => f.id === p.id)
            ? store.friends()
            : [...store.friends(), { ...p, since: Date.now() }],
        });
      },

      applyFriendRemoved(p: FriendRemovedPayload): void {
        patchState(store, {
          friends: store.friends().filter((f) => f.id !== p.userId),
          pending: store.pending().filter((x) => x.id !== p.userId),
        });
      },

      /** Patches a friend's/pending user's avatar when they change it live. */
      applyAvatar(userId: string, avatarKey: string | null): void {
        const patch = <T extends { id: string; avatarKey: string | null }>(list: T[]): T[] =>
          list.map((x) => (x.id === userId ? { ...x, avatarKey } : x));
        if (
          store.friends().some((f) => f.id === userId && f.avatarKey !== avatarKey) ||
          store.pending().some((p) => p.id === userId && p.avatarKey !== avatarKey)
        ) {
          patchState(store, {
            friends: patch(store.friends()),
            pending: patch(store.pending()),
          });
        }
      },
    };
  }),
  withHooks({
    // Own friend-graph events off the gateway stream (incoming requests, accepts, removals/blocks).
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'FriendRequest':
            store.applyFriendRequest(e.payload);
            break;
          case 'FriendAccepted':
            store.applyFriendAccepted(e.payload);
            break;
          case 'FriendRemoved':
            store.applyFriendRemoved(e.payload);
            break;
          case 'ProfileUpdated':
            store.applyAvatar(e.payload.userId, e.payload.avatarKey);
            break;
        }
      });
    },
  }),
);
