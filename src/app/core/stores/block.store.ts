import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { BlockedUser } from '../models/block.models';
import { BlockService } from '../services/block.service';

interface BlockState {
  blocked: BlockedUser[];
  loading: boolean;
}

export const BlockStore = signalStore(
  { providedIn: 'root' },
  withState<BlockState>({ blocked: [], loading: false }),
  withMethods((store, service = inject(BlockService)) => ({
    async load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        patchState(store, { blocked: await service.list() });
      } finally {
        patchState(store, { loading: false });
      }
    },

    /** Optimistically remove a blocked user; restore on failure. */
    async unblock(userId: string): Promise<void> {
      const previous = store.blocked();
      patchState(store, { blocked: previous.filter((u) => u.id !== userId) });
      try {
        await service.unblock(userId);
      } catch {
        patchState(store, { blocked: previous });
      }
    },
  })),
);
