export type MuteTargetType = 'guild' | 'channel' | 'user';

/** One active mute the caller holds (GET /api/mutes). `targetId` is a snowflake (string);
 *  timestamps are unix-ms numbers. `mutedUntil` null = indefinite. */
export interface Mute {
  targetType: MuteTargetType;
  targetId: string;
  mutedUntil: number | null;
  createdAt: number;
}
