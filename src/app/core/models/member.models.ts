/** A guild member's public identity + membership metadata. */
export interface GuildMember {
  userId: string;
  username: string;
  discriminator: string;
  nickname: string | null;
  avatarKey: string | null;
  isOwner: boolean;
  joinedAt: number;
}

/** A minimal mentionable identity — what the @-autocomplete dropdown needs to render and insert. */
export interface MentionCandidate {
  userId: string;
  username: string;
  avatarKey: string | null;
}
