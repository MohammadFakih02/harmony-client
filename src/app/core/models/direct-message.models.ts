/** One DM channel from the current user's perspective (peer identity + last-read marker). */
export interface DirectMessageChannel {
  channelId: string;
  peerId: string;
  peerUsername: string;
  peerAvatarKey: string | null;
  lastReadId: string;
}
