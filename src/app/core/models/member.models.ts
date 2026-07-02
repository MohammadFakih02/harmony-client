/** A guild member's public identity + membership metadata. */
export interface GuildMember {
  userId: string;
  username: string;
  nickname: string | null;
  avatarKey: string | null;
  isOwner: boolean;
  joinedAt: number;
  /** Unix-ms timeout expiry, or null. A future value means the member is currently timed out. */
  communicationDisabledUntil: number | null;
  /** Ids of the member's explicitly-assigned roles (excludes the implicit @everyone). */
  roleIds: string[];
}

/** The caller's guild-level capabilities (resolved server-side) — drives moderation/management UI. */
export interface GuildCapabilities {
  canManageGuild: boolean;
  canManageChannels: boolean;
  canManageRoles: boolean;
  canCreateInvite: boolean;
  canManageInvites: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  canViewAuditLog: boolean;
  canManageNicknames: boolean;
}

/** A guild ban row, enriched with banned-user + banning-moderator identity. */
export interface GuildBan {
  userId: string;
  username: string | null;
  avatarKey: string | null;
  bannedBy: string;
  bannedByUsername: string | null;
  reason: string | null;
  createdAt: number;
}

/** SignalR: a member was removed from a guild (kick / ban / leave). */
export interface MemberRemovedPayload {
  guildId: string;
  userId: string;
}

/** SignalR: the recipient was kicked or banned. `banned` distinguishes a ban from a kick. */
export interface KickedPayload {
  guildId: string;
  reason: string | null;
  banned: boolean;
}

/** SignalR: a member's guild-level state changed (timeout set/cleared, or server nickname changed).
 *  Carries the member's full mutable state so applying one field never clobbers the other. */
export interface MemberUpdatedPayload {
  guildId: string;
  userId: string;
  nickname: string | null;
  communicationDisabledUntil: number | null;
}

/** SignalR: a member joined a guild (invite redeem). Carries the full member so the list updates live. */
export interface MemberJoinedPayload {
  guildId: string;
  member: GuildMember;
}

/** A minimal mentionable identity — what the @-autocomplete dropdown needs to render and insert. */
export interface MentionCandidate {
  userId: string;
  username: string; // the literal inserted after '@' (a username, server nickname, role name, "everyone"/"here")
  avatarKey: string | null;
  /** Marks a broadcast mention (@everyone/@here) — rendered with an icon + description, not an avatar. */
  special?: 'everyone' | 'here';
  /** Marks a role mention — rendered with a coloured @ icon instead of an avatar. */
  role?: boolean;
  /** Role colour (hex) for a role candidate. */
  color?: string | null;
  /** Sub-label shown for special/role entries (e.g. "Notify everyone in this channel"). */
  description?: string;
}
