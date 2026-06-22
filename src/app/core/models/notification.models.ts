/** A notification row as returned by GET /api/notifications. */
export interface AppNotification {
  id: string;
  /** Raw backend string — "mention" | "friend_request" today; more may be added later. */
  type: string;
  actorId: string;
  guildId: string | null;
  channelId: string | null;
  messageId: string | null;
  isRead: boolean;
  createdAt: number;
}

/** SignalR NotificationReceived payload — same shape, minus isRead (a push is always unread). */
export type NotificationPayload = Omit<AppNotification, 'isRead'>;

/** Minimal actor identity for rendering a notification row. */
export interface NotificationActor {
  id: string;
  username: string;
  avatarKey: string | null;
}
