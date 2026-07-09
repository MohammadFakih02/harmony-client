/**
 * Voice/video state shapes (LiveKit Slice 2 — audio). A "participant" is one user connected to a
 * channel's voice room; the flags mirror the backend `VoiceParticipantPayload`. `isVideoOn` /
 * `isStreaming` are plumbed through now but always false until Slice 3 (video/screenshare).
 */
export interface VoiceParticipant {
  channelId: string;
  guildId: string | null; // null for a DM / group-DM call
  userId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isVideoOn: boolean;
  isStreaming: boolean;
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
