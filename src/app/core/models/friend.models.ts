/** An accepted friend — the other user's public identity + when the friendship began. */
export interface Friend {
  id: string;
  username: string;
  discriminator: string | null;
  avatarKey: string | null;
  bannerKey: string | null;
  since: number;
}

/** A pending friend request the current user is party to. */
export interface PendingFriend {
  id: string;
  username: string;
  discriminator: string | null;
  avatarKey: string | null;
  bannerKey: string | null;
  direction: 'incoming' | 'outgoing';
  createdAt: number;
}

/** SignalR payload for FriendRequest / FriendAccepted — the user the event concerns. */
export interface FriendUserPayload {
  id: string;
  username: string;
  discriminator: string | null;
  avatarKey: string | null;
  bannerKey: string | null;
}

/** SignalR payload for FriendRemoved. */
export interface FriendRemovedPayload {
  userId: string;
}
