import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Friend, FriendRemovedPayload, FriendUserPayload, PendingFriend } from '../models/friend.models';
import { FriendService } from '../services/friend.service';

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
  withMethods((store, service = inject(FriendService)) => {
    const reload = async (): Promise<void> => {
      const [friends, pending] = await Promise.all([service.getFriends(), service.getPending()]);
      patchState(store, { friends, pending });
    };

    return {
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
    };
  }),
);
