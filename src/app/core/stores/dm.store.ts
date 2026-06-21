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

    return {
      async load(): Promise<void> {
        patchState(store, { loading: true });
        try {
          patchState(store, { dms: await service.getMyDms() });
        } catch {
          // fail open — empty list
        } finally {
          patchState(store, { loading: false });
        }
      },

      /** Opens (or reuses) a DM and ensures it's in the list. Returns the channel. */
      async open(targetUserId: string): Promise<DirectMessageChannel> {
        const dm = await service.open(targetUserId);
        upsert(dm);
        return dm;
      },

      async hide(channelId: string): Promise<void> {
        patchState(store, { dms: store.dms().filter((d) => d.channelId !== channelId) });
        await service.hide(channelId).catch(() => {});
      },

      peerOf(channelId: string): DirectMessageChannel | undefined {
        return store.dms().find((d) => d.channelId === channelId);
      },

      /** A message arrived for a DM not in the list (it had been hidden) → refetch. */
      async ensureVisible(channelId: string): Promise<void> {
        if (store.dms().some((d) => d.channelId === channelId)) return;
        try {
          patchState(store, { dms: await service.getMyDms() });
        } catch {
          // ignore
        }
      },
    };
  }),
);
