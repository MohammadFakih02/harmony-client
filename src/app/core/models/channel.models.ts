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
