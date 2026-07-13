/** Per-guild / per-channel notification level (roadmap E#16). Mirrors the backend NotificationLevel. */
export type NotificationLevel = 'all' | 'mentions' | 'nothing';

export const NOTIFICATION_LEVEL_DEFAULT: NotificationLevel = 'mentions';

/** Selectable levels with their human labels, in display order. */
export const NOTIFICATION_LEVEL_OPTIONS: { value: NotificationLevel; label: string }[] = [
  { value: 'all', label: 'All Messages' },
  { value: 'mentions', label: 'Only @mentions' },
  { value: 'nothing', label: 'Nothing' },
];

export interface ChannelNotificationSetting {
  channelId: string;
  level: NotificationLevel;
  /** Suppress @everyone/@here (only) mentions for this channel. A direct @user/@role still notifies. */
  suppressEveryone: boolean;
}

/** The caller's settings for one guild: the resolved guild level + explicit per-channel overrides. */
export interface GuildNotificationSettings {
  guildLevel: NotificationLevel;
  /** Guild-wide @everyone/@here suppression; a channel override takes precedence when set. */
  guildSuppressEveryone: boolean;
  channels: ChannelNotificationSetting[];
}
