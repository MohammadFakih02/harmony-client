/** A guild member's public identity + membership metadata. */
export interface GuildMember {
  userId: string;
  username: string;
  nickname: string | null;
  avatarKey: string | null;
  isOwner: boolean;
  joinedAt: number;
}

/** A minimal mentionable identity — what the @-autocomplete dropdown needs to render and insert. */
export interface MentionCandidate {
  userId: string;
  username: string; // the literal inserted after '@' (e.g. "everyone", "here", or a username)
  avatarKey: string | null;
  /** Marks a broadcast mention (@everyone/@here) — rendered with an icon + description, not an avatar. */
  special?: 'everyone' | 'here';
  /** Sub-label shown for special entries (e.g. "Notify everyone in this channel"). */
  description?: string;
}
