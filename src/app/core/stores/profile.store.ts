import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { PublicUserProfile } from '../models/user.models';
import { UserService } from '../services/user.service';
import { GatewayEvents } from '../hub/gateway-events';

interface ProfileState {
  profiles: Record<string, PublicUserProfile>;
}

/**
 * Cached public profiles (`GET /api/users/{id}`), shared by every profile surface — the popout,
 * the full-profile modal, the DM peer panel, and the settings pages. A surface calls `refresh()`
 * when it opens: the cached copy paints instantly and the fresh fetch patches in behind it
 * (stale-while-revalidate), so banners/bios show up everywhere without per-surface fetch code.
 * Live `ProfileUpdated` avatar broadcasts patch the cache in place.
 */
export const ProfileStore = signalStore(
  { providedIn: 'root' },
  withState<ProfileState>({ profiles: {} }),
  withMethods((store, service = inject(UserService)) => {
    const inFlight = new Map<string, Promise<PublicUserProfile | null>>();

    const fetch = (userId: string): Promise<PublicUserProfile | null> => {
      const pending = inFlight.get(userId);
      if (pending) return pending;
      const run = service
        .getProfile(userId)
        .then((profile) => {
          patchState(store, { profiles: { ...store.profiles(), [userId]: profile } });
          return profile;
        })
        .catch(() => null) // fail-open: surfaces fall back to store-resolved identity
        .finally(() => inFlight.delete(userId));
      inFlight.set(userId, run);
      return run;
    };

    return {
      /** Cached profile, or undefined until a fetch lands. Reactive when read inside a computed. */
      profileOf(userId: string): PublicUserProfile | undefined {
        return store.profiles()[userId];
      },

      /** Fetch only when nothing is cached yet. */
      async loadIfNeeded(userId: string): Promise<void> {
        if (!store.profiles()[userId]) await fetch(userId);
      },

      /** Always refetch (cached copy keeps painting meanwhile). */
      async refresh(userId: string): Promise<PublicUserProfile | null> {
        return fetch(userId);
      },

      /** Patch a cached profile in place (own edits, live avatar broadcasts). No-op if uncached. */
      patch(userId: string, changes: Partial<PublicUserProfile>): void {
        const current = store.profiles()[userId];
        if (!current) return;
        patchState(store, { profiles: { ...store.profiles(), [userId]: { ...current, ...changes } } });
      },
    };
  }),
  withHooks({
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        if (e.type === 'ProfileUpdated')
          store.patch(e.payload.userId, {
            avatarKey: e.payload.avatarKey,
            ...(e.payload.username != null ? { username: e.payload.username } : {}),
          });
      });
    },
  }),
);
