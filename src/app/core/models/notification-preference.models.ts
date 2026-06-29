/** The current user's notification toggles (GET/PATCH /api/notifications/preferences).
 *  A user with no row yet reads all-true defaults from the backend. */
export interface NotificationPreferences {
  mentionsEnabled: boolean;
  repliesEnabled: boolean;
  friendRequests: boolean;
  guildInvites: boolean;
  pushEnabled: boolean;
}

/** Stable order + labels for rendering the toggle list. */
export const NOTIFICATION_PREFERENCE_FIELDS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  { key: 'mentionsEnabled', label: 'Mentions', description: 'When someone @mentions you.' },
  { key: 'repliesEnabled', label: 'Replies', description: 'When someone replies to your message.' },
  { key: 'friendRequests', label: 'Friend Requests', description: 'When someone adds you as a friend.' },
  { key: 'guildInvites', label: 'Server Invites', description: 'When you receive a server invite.' },
  { key: 'pushEnabled', label: 'Push Notifications', description: 'Browser push when you are away.' },
];
