/**
 * One aggregated reaction pill on a message: the emoji token (a Unicode char today; a
 * `custom:{emojiId}` string once custom emoji land — slice 3), how many distinct users reacted with
 * it, and whether the current viewer is one of them. The client recomputes count/meReacted locally
 * from the ReactionAdded/ReactionRemoved gateway events; the server sends the authoritative summary
 * with each loaded message.
 */
export interface ReactionSummary {
  emoji: string;
  count: number;
  meReacted: boolean;
}

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
  // Aggregated emoji reactions (server-authoritative on load; mutated live via the reaction
  // gateway events). Absent/undefined is treated as "no reactions".
  reactions?: ReactionSummary[];
  // Client-side only — not from the server
  pending?: boolean;
  failed?: boolean;
  failedReason?: string; // why a send failed (e.g. "…only accepts messages from friends"), shown by the Retry row
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

/**
 * A live reaction add/remove pushed to a channel group. Carries only the delta — the client finds
 * the message in its loaded window and recomputes that emoji's count + meReacted (meReacted flips
 * only when `userId` is the current user). Messages outside the window are ignored.
 */
export interface ReactionPayload {
  messageId: string;
  channelId: string;
  guildId: string | null;
  emoji: string;
  userId: string;
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
