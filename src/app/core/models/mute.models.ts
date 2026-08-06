export type MuteTargetType = 'guild' | 'channel' | 'user';

/** Mute durations offered by every mute context-menu (channel / guild / user);
 *  null = until manually unmuted. */
export const MUTE_DURATIONS: { label: string; minutes: number | null }[] = [
  { label: 'For 15 Minutes', minutes: 15 },
  { label: 'For 1 Hour', minutes: 60 },
  { label: 'For 3 Hours', minutes: 180 },
  { label: 'For 8 Hours', minutes: 480 },
  { label: 'For 24 Hours', minutes: 1440 },
  { label: 'Until I turn it back on', minutes: null },
];

/** One active mute the caller holds (GET /api/mutes). `targetId` is a snowflake (string);
 *  timestamps are unix-ms numbers. `mutedUntil` null = indefinite. */
export interface Mute {
  targetType: MuteTargetType;
  targetId: string;
  mutedUntil: number | null;
  createdAt: number;
}
