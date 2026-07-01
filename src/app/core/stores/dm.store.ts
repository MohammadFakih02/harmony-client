import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { DirectMessageChannel } from '../models/direct-message.models';
import { DirectMessageService } from '../services/direct-message.service';

interface DmState {
  dms: DirectMessageChannel[];
  loading: boolean;
}

export const DmStore = signalStore(
  { providedIn: 'root' },
  withState<DmState>({ dms: [], loading: false }),
  withMethods((store, service = inject(DirectMessageService)) => {
    const upsert = (dm: DirectMessageChannel): void => {
      const without = store.dms().filter((d) => d.channelId !== dm.channelId);
      patchState(store, { dms: [dm, ...without] });
    };

    const refetch = async (): Promise<void> => {
      try {
        patchState(store, { dms: await service.getMyDms() });
      } catch {
        // fail open — keep the current list
      }
    };

    return {
      async load(): Promise<void> {
        patchState(store, { loading: true });
        await refetch();
        patchState(store, { loading: false });
      },

      /** Opens (or reuses) a 1:1 DM and ensures it's in the list. Returns the channel. */
      async open(targetUserId: string): Promise<DirectMessageChannel> {
        const dm = await service.open(targetUserId);
        upsert(dm);
        return dm;
      },

      /** Creates a group DM with the given members (name optional). Returns the channel. */
      async createGroup(name: string | null, userIds: string[]): Promise<DirectMessageChannel> {
        const dm = await service.createGroup(name, userIds);
        upsert(dm);
        return dm;
      },

      /** Adds a user to a group DM, then refreshes the list to pick up the new member. */
      async addParticipant(channelId: string, userId: string): Promise<void> {
        await service.addParticipant(channelId, userId);
        await refetch();
      },

      /** Leaves a group DM (optimistically removes it from the list). */
      async leave(channelId: string): Promise<void> {
        patchState(store, { dms: store.dms().filter((d) => d.channelId !== channelId) });
        await service.leave(channelId).catch(() => {});
      },

      async hide(channelId: string): Promise<void> {
        patchState(store, { dms: store.dms().filter((d) => d.channelId !== channelId) });
        await service.hide(channelId).catch(() => {});
      },

      /** The DM channel for an id, if it's in the loaded list. */
      find(channelId: string): DirectMessageChannel | undefined {
        return store.dms().find((d) => d.channelId === channelId);
      },

      /** Membership changed (group create/add/leave) elsewhere → resync the list. */
      async resync(): Promise<void> {
        await refetch();
      },

      /** A message arrived for a DM not in the list (it had been hidden) → refetch. */
      async ensureVisible(channelId: string): Promise<void> {
        if (store.dms().some((d) => d.channelId === channelId)) return;
        await refetch();
      },
    };
  }),
);
