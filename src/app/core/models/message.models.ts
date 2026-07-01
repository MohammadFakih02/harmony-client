export interface MessageResponse {
  messageId: string;
  channelId: string;
  guildId: string | null;
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

/**
 * A pinned message: the full message (rendered exactly like any message) plus who pinned it.
 * `pinnedBy`/`pinnedAt` are Snowflake ids kept as strings (pinnedAt equals the message id —
 * the pin's clustering key — so it exceeds 2^53 and must never be coerced to a JS number).
 */
export interface PinnedMessageResponse {
  message: MessageResponse;
  pinnedBy: string;
  pinnedAt: string;
}

/**
 * The message currently being replied to. A slim projection (not the full MessageResponse) — it
 * only needs to render the composer's "Replying to …" banner and supply replyToId on send. The
 * author name is resolved (nickname-aware) by the message list at the moment Reply is clicked.
 */
export interface ReplyTarget {
  messageId: string;
  authorName: string;
  content: string;
}

export interface SendMessageResponse {
  messageId: string;
  channelId: string;
  guildId: string | null;
}

export interface MessageFailedPayload {
  messageId: string;
  channelId: string;
  guildId: string | null;
}

export interface UnreadCountPayload {
  channelId: string;
  guildId: string | null;
  unreadCount: number;
}

export interface UnreadCountResponse {
  channelId: string;
  guildId: string | null;
  unreadCount: number;
}
