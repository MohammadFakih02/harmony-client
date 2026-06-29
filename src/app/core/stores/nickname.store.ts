import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { NicknameService } from '../services/nickname.service';

interface NicknameState {
  // Private aliases the caller has set, keyed by targetId. Owner-scoped — only ever the caller's own.
  byUser: Record<string, string>;
  loaded: boolean;
}

/**
 * The caller's friend (private, per-user) nicknames — the display name used in DMs and the friends
 * list. Loaded once on startup, then mutated optimistically by the profile edit UI.
 */
export const NicknameStore = signalStore(
  { providedIn: 'root' },
  withState<NicknameState>({ byUser: {}, loaded: false }),
  withMethods((store, service = inject(NicknameService)) => ({
    /** My alias for a user, or null if none is set. */
    nicknameOf(userId: string): string | null {
      return store.byUser()[userId] ?? null;
    },

    /** Loads the caller's whole nickname map once; a no-op if already loaded. */
    async load(): Promise<void> {
      if (store.loaded()) return;
      try {
        const byUser = await service.getMine();
        patchState(store, { byUser, loaded: true });
      } catch {
        // Fail open — leave empty; names fall back to username.
      }
    },

    /** Set (or, when blank, clear) my alias for a user, optimistically. Reverts on failure. */
    async set(userId: string, nickname: string): Promise<void> {
      const trimmed = nickname.trim();
      const prev = store.byUser();
      const next = { ...prev };
      if (trimmed) next[userId] = trimmed;
      else delete next[userId];
      patchState(store, { byUser: next });
      try {
        if (trimmed) await service.set(userId, trimmed);
        else await service.clear(userId);
      } catch {
        patchState(store, { byUser: prev });
      }
    },

    /** Remove my alias for a user, optimistically. Reverts on failure. */
    async remove(userId: string): Promise<void> {
      const prev = store.byUser();
      const next = { ...prev };
      delete next[userId];
      patchState(store, { byUser: next });
      try {
        await service.clear(userId);
      } catch {
        patchState(store, { byUser: prev });
      }
    },
  })),
);
