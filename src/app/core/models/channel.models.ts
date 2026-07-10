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
}

export interface ChannelCategory {
  id: string | null;
  name: string;
  channels: Channel[];
  collapsed: boolean;
}

/** The caller's effective capabilities in a channel (computed server-side). */
export interface ChannelCapabilities {
  canView: boolean;
  canSend: boolean;
  canAttach: boolean;
  canManageMessages: boolean;
  canManageChannels: boolean;
  canPin: boolean;
  canUseVideo: boolean;
  canStream: boolean;
  timedOut: boolean;
}
