import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { GuildMember } from '../models/member.models';
import { MemberService } from '../services/member.service';

interface MemberState {
  byGuild: Record<string, GuildMember[]>;
  loading: boolean;
}

export const MemberStore = signalStore(
  { providedIn: 'root' },
  withState<MemberState>({ byGuild: {}, loading: false }),
  withMethods((store, service = inject(MemberService)) => ({
    /** Returns the cached member list for a guild, or an empty array if not loaded yet. */
    membersOf(guildId: string): GuildMember[] {
      return store.byGuild()[guildId] ?? [];
    },

    /** Fetches a guild's members once and caches them; a no-op if already cached. */
    async loadIfNeeded(guildId: string): Promise<void> {
      if (store.byGuild()[guildId]) return;
      patchState(store, { loading: true });
      try {
        const members = await service.getMembers(guildId);
        patchState(store, { byGuild: { ...store.byGuild(), [guildId]: members }, loading: false });
      } catch {
        patchState(store, { loading: false });
      }
    },
  })),
);
