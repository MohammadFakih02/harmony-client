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
}

/** The caller's settings for one guild: the resolved guild level + explicit per-channel overrides. */
export interface GuildNotificationSettings {
  guildLevel: NotificationLevel;
  channels: ChannelNotificationSetting[];
}
