import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { GuildCapabilities, GuildMember } from '../models/member.models';
import { GatewayEvents } from '../hub/gateway-events';
import { MemberService } from '../services/member.service';
import { AuthService } from '../services/auth.service';

interface MemberState {
  byGuild: Record<string, GuildMember[]>;
  capsByGuild: Record<string, GuildCapabilities>;
  // Member ids that can ViewChannel a given channel, keyed by channelId (null = not loaded).
  viewersByChannel: Record<string, string[]>;
  loading: boolean;
}

export const MemberStore = signalStore(
  { providedIn: 'root' },
  withState<MemberState>({ byGuild: {}, capsByGuild: {}, viewersByChannel: {}, loading: false }),
  withMethods((store, service = inject(MemberService)) => {
    // Dedupe concurrent loads for the same key (non-reactive — purely a stampede guard).
    // On guild activate, shell + member-sidebar + message-input all call loadIfNeeded before
    // the cache fills; without this each fires its own GET.
    const inFlight = new Map<string, Promise<void>>();

    // Self-heal throttle: last time we reloaded a guild because a live event referenced an
    // unknown member (see ensureKnown). Caps the refetch to once per guild per window so an
    // event for a genuinely-non-member (or a reload that hasn't landed yet) can't spam the API.
    const lastEnsureAt = new Map<string, number>();

    const dedupe = (key: string, run: () => Promise<void>): Promise<void> => {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = run().finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    };

    return {
    /** Returns the cached member list for a guild, or an empty array if not loaded yet. */
    membersOf(guildId: string): GuildMember[] {
      return store.byGuild()[guildId] ?? [];
    },

    /** The caller's cached guild-level capabilities, or null if not loaded yet. */
    capabilitiesOf(guildId: string): GuildCapabilities | null {
      return store.capsByGuild()[guildId] ?? null;
    },

    /** Fetches a guild's members once and caches them; a no-op if already cached or in flight. */
    async loadIfNeeded(guildId: string): Promise<void> {
      if (store.byGuild()[guildId]) return;
      return dedupe(`members:${guildId}`, async () => {
        patchState(store, { loading: true });
        try {
          const members = await service.getMembers(guildId);
          patchState(store, { byGuild: { ...store.byGuild(), [guildId]: members }, loading: false });
        } catch {
          patchState(store, { loading: false });
        }
      });
    },

    /** Forces a refresh of a guild's members (used to reconcile after a socket reconnect). */
    async reload(guildId: string): Promise<void> {
      const members = await service.getMembers(guildId);
      patchState(store, { byGuild: { ...store.byGuild(), [guildId]: members } });
    },

    /**
     * The member ids that can view a channel, or null if not loaded yet. Null means
     * "don't filter" (show everyone) — the sidebar only restricts once the set is known.
     */
    channelViewers(channelId: string): string[] | null {
      return store.viewersByChannel()[channelId] ?? null;
    },

    /** Fetches the channel's viewer id set once and caches it per channel; a no-op if cached or in flight. */
    async loadViewersIfNeeded(guildId: string, channelId: string): Promise<void> {
      if (store.viewersByChannel()[channelId]) return;
      return dedupe(`viewers:${channelId}`, async () => {
        try {
          const viewers = await service.getChannelViewers(guildId, channelId);
          patchState(store, {
            viewersByChannel: { ...store.viewersByChannel(), [channelId]: viewers },
          });
        } catch {
          // Fail open — leave unset so the sidebar shows everyone rather than hiding members.
        }
      });
    },

    /**
     * Re-resolves a channel's viewer set, overwriting the cache. Called when the member list grows
     * (someone joined): the cached set was resolved before they existed, so the sidebar's
     * ViewChannel filter would keep hiding a just-joined member until a channel switch otherwise.
     */
    async refreshViewers(guildId: string, channelId: string): Promise<void> {
      return dedupe(`viewers-refresh:${channelId}`, async () => {
        try {
          const viewers = await service.getChannelViewers(guildId, channelId);
          patchState(store, {
            viewersByChannel: { ...store.viewersByChannel(), [channelId]: viewers },
          });
        } catch {
          // Fail open — leave the existing set; the sidebar still shows previously-known members.
        }
      });
    },

    /** Fetches the caller's guild capabilities once and caches them; a no-op if cached or in flight. */
    async loadCapabilitiesIfNeeded(guildId: string): Promise<void> {
      if (store.capsByGuild()[guildId]) return;
      return dedupe(`caps:${guildId}`, async () => {
        try {
          const caps = await service.getCapabilities(guildId);
          patchState(store, { capsByGuild: { ...store.capsByGuild(), [guildId]: caps } });
        } catch {
          // Leave unset → the UI hides moderation actions (fail-closed for management UI).
        }
      });
    },

    /**
     * Force-refreshes a guild's cached capabilities after a role change, so the moderation/settings
     * UI (manage guild/roles, ban, audit-log, manage channels) updates live without a page reload.
     * A no-op when the guild's caps aren't cached — they'll load fresh on next demand anyway.
     * Keeps the stale value on failure; the server still enforces regardless of the UI.
     */
    async refreshCapabilities(guildId: string): Promise<void> {
      if (!store.capsByGuild()[guildId]) return;
      try {
        const caps = await service.getCapabilities(guildId);
        patchState(store, { capsByGuild: { ...store.capsByGuild(), [guildId]: caps } });
      } catch {
        // Leave the cached value in place.
      }
    },

    /**
     * Self-heal: a live event (typing / voice / message) referenced a user we don't have in the
     * guild's cached member list, so the MemberJoined broadcast that should have added them was
     * missed. Refetch the whole list (throttled per guild) so the newcomer stops rendering as
     * "Someone" / a ghost until a manual refresh. A no-op when the guild isn't loaded (nothing to
     * reconcile against) or the user is already known.
     */
    ensureKnown(guildId: string, userId: string): void {
      const list = store.byGuild()[guildId];
      if (!list || list.some((m) => m.userId === userId)) return;
      const now = Date.now();
      if (now - (lastEnsureAt.get(guildId) ?? 0) < 4000) return;
      lastEnsureAt.set(guildId, now);
      void this.reload(guildId).catch(() => {});
    },

    /** Adds a member to local state (invite redeem via SignalR). Cache-guarded + idempotent — a
     *  no-op if the guild isn't loaded or the member is already present. */
    addMember(guildId: string, member: GuildMember): void {
      const list = store.byGuild()[guildId];
      if (!list || list.some((m) => m.userId === member.userId)) return;
      patchState(store, {
        byGuild: { ...store.byGuild(), [guildId]: [...list, member] },
      });
    },

    /**
     * Drops every cache for a guild — used when *we* are kicked/banned, so a later rejoin refetches
     * fresh state instead of reviving the stale pre-kick lists (which no longer contain us; the
     * MemberJoined broadcast can't fix that, since we aren't in the guild's SignalR group at redeem
     * time). Viewer sets are keyed by channel and can't be mapped back to a guild here, so they're
     * all dropped — they refetch on channel open.
     */
    clearGuild(guildId: string): void {
      const { [guildId]: _members, ...byGuild } = store.byGuild();
      const { [guildId]: _caps, ...capsByGuild } = store.capsByGuild();
      patchState(store, { byGuild, capsByGuild, viewersByChannel: {} });
    },

    /** Removes a member from local state (kick / ban / leave — own action or SignalR event). */
    removeMember(guildId: string, userId: string): void {
      const list = store.byGuild()[guildId];
      if (!list) return;
      patchState(store, {
        byGuild: { ...store.byGuild(), [guildId]: list.filter((m) => m.userId !== userId) },
      });
    },

    /** Applies a partial update to a cached member (shared by timeout/nickname/role updaters). */
    patchMember(guildId: string, userId: string, patch: Partial<GuildMember>): void {
      const list = store.byGuild()[guildId];
      if (!list) return;
      patchState(store, {
        byGuild: {
          ...store.byGuild(),
          [guildId]: list.map((m) => (m.userId === userId ? { ...m, ...patch } : m)),
        },
      });
    },

    /** Applies a member's timeout change (set/cleared) to local state. */
    applyMemberUpdated(guildId: string, userId: string, until: number | null): void {
      this.patchMember(guildId, userId, { communicationDisabledUntil: until });
    },

    /** Applies a member's nickname change to local state (SignalR or own optimistic update). */
    applyMemberNickname(guildId: string, userId: string, nickname: string | null): void {
      this.patchMember(guildId, userId, { nickname });
    },

    /** Applies a member's role-assignment change (their full current role-id set). */
    applyMemberRoleUpdated(guildId: string, userId: string, roleIds: string[]): void {
      this.patchMember(guildId, userId, { roleIds });
    },

    /** Applies a user's avatar and/or username change across EVERY loaded guild (a profile change
     * isn't guild-scoped). Username is applied only when non-null — a server nickname (separate
     * field) still takes display precedence, this just keeps the underlying username in sync. */
    applyAvatar(userId: string, avatarKey: string | null, username?: string | null): void {
      const byGuild = store.byGuild();
      const next: Record<string, GuildMember[]> = {};
      let changed = false;
      for (const [guildId, list] of Object.entries(byGuild)) {
        if (
          list.some(
            (m) =>
              m.userId === userId &&
              (m.avatarKey !== avatarKey || (username != null && m.username !== username)),
          )
        ) {
          next[guildId] = list.map((m) =>
            m.userId === userId ? { ...m, avatarKey, ...(username != null ? { username } : {}) } : m,
          );
          changed = true;
        } else {
          next[guildId] = list;
        }
      }
      if (changed) patchState(store, { byGuild: next });
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

    /** Set your own server nickname (blank clears). Optimistically patches the cached member. */
    async setOwnNickname(guildId: string, myUserId: string, nickname: string | null): Promise<void> {
      await service.setOwnNickname(guildId, nickname);
      this.applyMemberNickname(guildId, myUserId, nickname);
    },

    /** Rename another member (ManageNicknames). Optimistically patches the cached member. */
    async setNickname(guildId: string, userId: string, nickname: string | null): Promise<void> {
      await service.setNickname(guildId, userId, nickname);
      this.applyMemberNickname(guildId, userId, nickname);
    },
    };
  }),
  withHooks({
    // Own member moderation/role events off the gateway stream. Each apply-method cache-guards on
    // the guild being loaded, so events for unloaded guilds are ignored. `Kicked` targets only the
    // affected user (navigation) and stays in the shell.
    onInit(store, gateway = inject(GatewayEvents), auth = inject(AuthService)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'MemberJoined':
            store.addMember(e.payload.guildId, e.payload.member);
            break;
          // Self-heal backstop: if a message or voice event names someone we don't have (a missed
          // MemberJoined), refetch the guild's members so they resolve instead of showing "Someone".
          case 'MessageReceived':
            if (e.message.guildId) store.ensureKnown(e.message.guildId, e.message.userId);
            break;
          case 'VoiceParticipantJoined':
          case 'VoiceStateUpdated':
            if (e.payload.guildId) store.ensureKnown(e.payload.guildId, e.payload.userId);
            break;
          case 'MemberRemoved':
            store.removeMember(e.payload.guildId, e.payload.userId);
            break;
          case 'MemberUpdated':
            // One event carries the member's full mutable state — apply both so neither field
            // (nickname / timeout) clobbers the other.
            store.patchMember(e.payload.guildId, e.payload.userId, {
              nickname: e.payload.nickname,
              communicationDisabledUntil: e.payload.communicationDisabledUntil,
            });
            break;
          case 'RoleUpserted':
            // A role's permission bits may have changed — any holder's resolved guild capabilities
            // can shift, so refresh live (rare admin action; cheap and only if caps are cached).
            store.refreshCapabilities(e.role.guildId);
            break;
          case 'RoleDeleted':
            store.refreshCapabilities(e.payload.guildId);
            break;
          case 'MemberRoleUpdated':
            store.applyMemberRoleUpdated(e.payload.guildId, e.payload.userId, e.payload.roleIds);
            // If MY role assignments changed, my own capabilities may have shifted.
            if (e.payload.userId === auth.currentUser()?.id)
              store.refreshCapabilities(e.payload.guildId);
            break;
          case 'ProfileUpdated':
            store.applyAvatar(e.payload.userId, e.payload.avatarKey, e.payload.username);
            break;
        }
      });
    },
  }),
);
