export interface MessageResponse {
  messageId: number;
  channelId: number;
  guildId: number;
  userId: number;
  username: string;
  avatarKey: string | null;
  content: string;
  createdAt: string;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  messageType: string;
  attachmentIds: number[];
  mentionIds: number[];
  replyToId: number | null;
  // Client-side only — not from the server
  pending?: boolean;
  failed?: boolean;
  tempId?: number;
}

export interface ChannelMessagesResponse {
  messages: MessageResponse[];
  degraded: boolean;
}

export interface SendMessageResponse {
  messageId: number;
  channelId: number;
  guildId: number;
}

export interface MessageFailedPayload {
  messageId: number;
  channelId: number;
  guildId: number;
}

export interface UnreadCountPayload {
  channelId: number;
  guildId: number;
  unreadCount: number;
}

export interface UnreadCountResponse {
  channelId: number;
  unreadCount: number;
}
