import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Mute, MuteTargetType } from '../models/mute.models';
import { MuteService } from '../services/mute.service';

interface MuteState {
  mutes: Mute[];
  loading: boolean;
}

/** Active target-ids of one mute kind, expiry-aware (an expired-but-unswept row doesn't mute). */
const activeIds = (mutes: Mute[], kind: MuteTargetType): Set<string> => {
  const now = Date.now();
  return new Set(
    mutes
      .filter((m) => m.targetType === kind && (m.mutedUntil === null || m.mutedUntil > now))
      .map((m) => m.targetId),
  );
};

export const MuteStore = signalStore(
  { providedIn: 'root' },
  withState<MuteState>({ mutes: [], loading: false }),
  withComputed((store) => ({
    mutedChannelIds: computed(() => activeIds(store.mutes(), 'channel')),
    mutedGuildIds: computed(() => activeIds(store.mutes(), 'guild')),
    mutedUserIds: computed(() => activeIds(store.mutes(), 'user')),
  })),
  withMethods((store, service = inject(MuteService)) => ({
    isMuted(targetType: MuteTargetType, targetId: string): boolean {
      return activeIds(store.mutes(), targetType).has(targetId);
    },

    /** Mutes a target; `minutes` null = until manual unmute. Optimistic (upsert), reverts on failure. */
    async mute(targetType: MuteTargetType, targetId: string, minutes: number | null): Promise<void> {
      const previous = store.mutes();
      const mutedUntil = minutes === null ? null : Date.now() + minutes * 60_000;
      const optimistic: Mute = { targetType, targetId, mutedUntil, createdAt: Date.now() };
      patchState(store, {
        mutes: [
          optimistic,
          ...previous.filter((m) => !(m.targetType === targetType && m.targetId === targetId)),
        ],
      });
      try {
        await service.create(targetType, targetId, mutedUntil);
      } catch {
        patchState(store, { mutes: previous });
      }
    },

    async load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        patchState(store, { mutes: await service.list() });
      } finally {
        patchState(store, { loading: false });
      }
    },

    /** Optimistically drop a mute; restore it if the unmute fails. */
    async remove(targetType: MuteTargetType, targetId: string): Promise<void> {
      const previous = store.mutes();
      patchState(store, {
        mutes: previous.filter((m) => !(m.targetType === targetType && m.targetId === targetId)),
      });
      try {
        await service.remove(targetType, targetId);
      } catch {
        patchState(store, { mutes: previous });
      }
    },
  })),
);
