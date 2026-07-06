import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { BlockedUser } from '../models/block.models';
import { BlockService } from '../services/block.service';

interface BlockState {
  blocked: BlockedUser[];
  loading: boolean;
}

/** Identity known at block time (context menu / profile) — the rest fills in on the next load. */
export interface BlockTarget {
  id: string;
  username: string;
  avatarKey?: string | null;
}

export const BlockStore = signalStore(
  { providedIn: 'root' },
  withState<BlockState>({ blocked: [], loading: false }),
  withComputed((store) => ({
    /** Blocked user ids as a Set — the message/typing filters read this per recompute. */
    blockedIds: computed(() => new Set(store.blocked().map((u) => u.id))),
  })),
  withMethods((store, service = inject(BlockService)) => ({
    isBlocked(userId: string): boolean {
      return store.blockedIds().has(userId);
    },

    async load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        patchState(store, { blocked: await service.list() });
      } finally {
        patchState(store, { loading: false });
      }
    },

    /** Optimistically block a user; revert on failure. Idempotent server-side. */
    async block(target: BlockTarget): Promise<void> {
      const previous = store.blocked();
      if (previous.some((u) => u.id === target.id)) return;
      patchState(store, {
        blocked: [
          {
            id: target.id,
            username: target.username,
            avatarKey: target.avatarKey ?? null,
            bannerKey: null,
            createdAt: Date.now(),
          },
          ...previous,
        ],
      });
      try {
        await service.block(target.id);
      } catch (err) {
        patchState(store, { blocked: previous });
        throw err;
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
