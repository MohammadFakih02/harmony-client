import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { GuildCapabilities, GuildMember } from '../models/member.models';
import { MemberService } from '../services/member.service';

interface MemberState {
  byGuild: Record<string, GuildMember[]>;
  capsByGuild: Record<string, GuildCapabilities>;
  loading: boolean;
}

export const MemberStore = signalStore(
  { providedIn: 'root' },
  withState<MemberState>({ byGuild: {}, capsByGuild: {}, loading: false }),
  withMethods((store, service = inject(MemberService)) => ({
    /** Returns the cached member list for a guild, or an empty array if not loaded yet. */
    membersOf(guildId: string): GuildMember[] {
      return store.byGuild()[guildId] ?? [];
    },

    /** The caller's cached guild-level capabilities, or null if not loaded yet. */
    capabilitiesOf(guildId: string): GuildCapabilities | null {
      return store.capsByGuild()[guildId] ?? null;
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

    /** Fetches the caller's guild capabilities once and caches them; a no-op if already cached. */
    async loadCapabilitiesIfNeeded(guildId: string): Promise<void> {
      if (store.capsByGuild()[guildId]) return;
      try {
        const caps = await service.getCapabilities(guildId);
        patchState(store, { capsByGuild: { ...store.capsByGuild(), [guildId]: caps } });
      } catch {
        // Leave unset → the UI hides moderation actions (fail-closed for management UI).
      }
    },

    /** Removes a member from local state (kick / ban / leave — own action or SignalR event). */
    removeMember(guildId: string, userId: string): void {
      const list = store.byGuild()[guildId];
      if (!list) return;
      patchState(store, {
        byGuild: { ...store.byGuild(), [guildId]: list.filter((m) => m.userId !== userId) },
      });
    },

    /** Applies a member's timeout change (set/cleared) to local state. */
    applyMemberUpdated(guildId: string, userId: string, until: number | null): void {
      const list = store.byGuild()[guildId];
      if (!list) return;
      patchState(store, {
        byGuild: {
          ...store.byGuild(),
          [guildId]: list.map((m) =>
            m.userId === userId ? { ...m, communicationDisabledUntil: until } : m,
          ),
        },
      });
    },

    /** Applies a member's role-assignment change (their full current role-id set). */
    applyMemberRoleUpdated(guildId: string, userId: string, roleIds: string[]): void {
      const list = store.byGuild()[guildId];
      if (!list) return;
      patchState(store, {
        byGuild: {
          ...store.byGuild(),
          [guildId]: list.map((m) => (m.userId === userId ? { ...m, roleIds } : m)),
        },
      });
    },

    // ---- moderation actions (call the API, then update local state) ----

    async kick(guildId: string, userId: string): Promise<void> {
      await service.kick(guildId, userId);
      this.removeMember(guildId, userId);
    },

    async ban(guildId: string, userId: string, reason: string | null): Promise<void> {
      await service.ban(guildId, userId, reason);
      this.removeMember(guildId, userId);
    },

    async timeout(guildId: string, userId: string, durationSeconds: number): Promise<void> {
      await service.timeout(guildId, userId, durationSeconds);
      this.applyMemberUpdated(guildId, userId, Date.now() + durationSeconds * 1000);
    },

    async clearTimeout(guildId: string, userId: string): Promise<void> {
      await service.clearTimeout(guildId, userId);
      this.applyMemberUpdated(guildId, userId, null);
    },
  })),
);
