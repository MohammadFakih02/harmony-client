import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { NotificationPreferences } from '../models/notification-preference.models';
import { NotificationPreferenceService } from '../services/notification-preference.service';

interface NotificationPreferenceState {
  preferences: NotificationPreferences | null;
  loading: boolean;
}

export const NotificationPreferenceStore = signalStore(
  { providedIn: 'root' },
  withState<NotificationPreferenceState>({ preferences: null, loading: false }),
  withMethods((store, service = inject(NotificationPreferenceService)) => ({
    async load(): Promise<void> {
      patchState(store, { loading: true });
      try {
        patchState(store, { preferences: await service.get() });
      } finally {
        patchState(store, { loading: false });
      }
    },

    /** Optimistically flip one flag; revert to the server's truth if the PATCH fails. */
    async setFlag(key: keyof NotificationPreferences, value: boolean): Promise<void> {
      const current = store.preferences();
      if (!current) return;
      const previous = current;
      patchState(store, { preferences: { ...current, [key]: value } });
      try {
        patchState(store, { preferences: await service.update({ [key]: value }) });
      } catch {
        patchState(store, { preferences: previous });
      }
    },
  })),
);
