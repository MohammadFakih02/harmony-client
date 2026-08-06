/**
 * Voice/video state shapes (LiveKit Slice 2 — audio). A "participant" is one user connected to a
 * channel's voice room; the flags mirror the backend `VoiceParticipantPayload`. The server flags
 * (`isServerMuted`/`isServerDeafened`) are moderator-imposed and orthogonal to the self flags —
 * only a moderator clears them, and they survive leave/rejoin (sticky per guild member).
 */
export interface VoiceParticipant {
  channelId: string;
  guildId: string | null; // null for a DM / group-DM call
  userId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isVideoOn: boolean;
  isStreaming: boolean;
  isServerMuted: boolean;
  isServerDeafened: boolean;
  joinedAt: number;
}

/** A user leaving a voice room (only the identifying trio travels). */
export interface VoiceParticipantLeft {
  channelId: string;
  guildId: string | null;
  userId: string;
}

/** The token/room descriptor minted by `POST /api/channels/{id}/voice/token`. */
export interface VoiceTokenResponse {
  token: string;
  url: string; // the LiveKit Cloud ws URL — authoritative, from the server (not environment)
  roomName: string; // always the channelId
}

// --- DM/group-DM call ringing (Slice 4) ---

/** A DM/group-DM call started ringing (sent per-user to participants minus the caller). */
export interface IncomingCallPayload {
  channelId: string;
  callerId: string;
  startedAt: number; // unix-ms
}

/** The ring ended unanswered (caller cancelled/timed out, or you declined on another tab). */
export interface CallCancelledPayload {
  channelId: string;
}

/** A callee declined the ring; sent to the caller. `userId` is the decliner. */
export interface CallDeclinedPayload {
  channelId: string;
  userId: string;
}

// --- Voice moderation (Slice B1) ---

/** A moderator moved you to another voice channel — reconnect media there (targeted, per-user). */
export interface VoiceForceMovedPayload {
  fromChannelId: string;
  toChannelId: string;
  guildId: string | null;
}
