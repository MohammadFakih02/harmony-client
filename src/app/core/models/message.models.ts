export interface MessageResponse {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  username: string;
  avatarKey: string | null;
  content: string;
  /** Unix milliseconds timestamp from the server (safe JS number — 13 digits) */
  sentAt: number;
  isEdited: boolean;
  editedAt: number | null;
  isDeleted: boolean;
  messageType: string;
  attachmentIds: string[];
  mentionIds: string[];
  replyToId: string | null;
  // Client-side only — not from the server
  pending?: boolean;
  failed?: boolean;
  tempId?: number; // local negative counter; never a Snowflake
}

export interface ChannelMessagesResponse {
  messages: MessageResponse[];
  degraded: boolean;
}

export interface SendMessageResponse {
  messageId: string;
  channelId: string;
  guildId: string;
}

export interface MessageFailedPayload {
  messageId: string;
  channelId: string;
  guildId: string;
}

export interface UnreadCountPayload {
  channelId: string;
  guildId: string;
  unreadCount: number;
}

export interface UnreadCountResponse {
  channelId: string;
  unreadCount: number;
}
