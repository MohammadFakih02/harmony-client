export type ChannelType = 'text' | 'voice' | 'announcement' | 'dm' | 'group_dm' | 'category';

export interface Channel {
  id: number;
  guildId: number;
  name: string;
  topic: string | null;
  type: ChannelType;
  position: number;
  categoryId: number | null;
  isNsfw: boolean;
  slowmodeSeconds: number;
}

export interface ChannelCategory {
  id: number | null;
  name: string;
  channels: Channel[];
  collapsed: boolean;
}
