import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Mute, MuteTargetType } from '../models/mute.models';
import { MuteService } from '../services/mute.service';

interface MuteState {
  mutes: Mute[];
  loading: boolean;
}

export const MuteStore = signalStore(
  { providedIn: 'root' },
  withState<MuteState>({ mutes: [], loading: false }),
  withMethods((store, service = inject(MuteService)) => ({
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
