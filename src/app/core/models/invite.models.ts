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
  iconKey: string | null;
  memberCount: number;
  channelId: string | null;
}

/** Soft embed preview — always a 200; a dead code is a state, not an error. */
export interface InviteEmbedPreview {
  status: 'ok' | 'expired' | 'invalid';
  invite: InvitePreview | null;
}

/** Options for minting an invite. All optional — the default is a guild-level, unlimited, never-expiring code. */
export interface CreateInviteOptions {
  channelId?: string;
  maxUses?: number;
  expiresInSeconds?: number;
}
