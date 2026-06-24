export interface Invite {
  code: string;
  guildId: string;
  channelId: string | null; // null = guild-level invite
  creatorId: string;
  creatorUsername: string | null;
  maxUses: number | null; // null = unlimited
  useCount: number;
  expiresAt: number | null; // unix-ms; null = never expires
  createdAt: number; // unix-ms
}

export interface InvitePreview {
  code: string;
  guildId: string;
  guildName: string;
  memberCount: number;
  channelId: string | null;
}

/** Options for minting an invite. All optional — the default is a guild-level, unlimited, never-expiring code. */
export interface CreateInviteOptions {
  channelId?: string;
  maxUses?: number;
  expiresInSeconds?: number;
}
