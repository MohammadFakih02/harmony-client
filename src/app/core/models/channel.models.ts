export type ChannelType = 'text' | 'voice' | 'announcement' | 'dm' | 'group_dm' | 'category';

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  topic: string | null;
  type: ChannelType;
  position: number;
  categoryId: string | null;
  isNsfw: boolean;
  slowmodeSeconds: number;
  bitrate: number | null; // voice only — bps (8k–96k); null elsewhere
  userLimit: number | null; // voice only — max participants; null = unlimited (0 clears on save)
}

export interface ChannelCategory {
  id: string;
  name: string;
  channels: Channel[];
  collapsed: boolean;
}

/**
 * One top-level row of the channel sidebar: a category block (header + its channels) or a bare
 * uncategorized channel — interleaved in global position order, so a channel can sit below a
 * category without belonging to it (Discord-style).
 */
export type SidebarEntry =
  | { kind: 'category'; category: ChannelCategory }
  | { kind: 'channel'; channel: Channel };

/**
 * A channel permission override — an allow/deny bit pair layered on top of a target role's or
 * member's resolved guild permissions ((perms & ~deny) | allow). Bits are ≤ 1<<26, so plain JS
 * bitwise ops are safe; the service coerces them to numbers on read.
 */
export interface ChannelOverride {
  id: string;
  channelId: string;
  targetId: string;
  targetType: 'role' | 'user';
  allowBits: number;
  denyBits: number;
}

/** The caller's effective capabilities in a channel (computed server-side). */
export interface ChannelCapabilities {
  canView: boolean;
  canSend: boolean;
  canAttach: boolean;
  canManageMessages: boolean;
  canManageChannels: boolean;
  canPin: boolean;
  canReact: boolean;
  canUseVideo: boolean;
  canStream: boolean;
  timedOut: boolean;
}
