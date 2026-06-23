/**
 * Presence status values. `online | away | dnd | offline` are the public *effective*
 * statuses others can see; `invisible` is a preferred-only choice that the server
 * masks as `offline` to everyone else (the user's own tabs still see `invisible`).
 */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'invisible' | 'offline';

/** The four values a user may pick for themselves. */
export type PreferredStatus = 'online' | 'away' | 'dnd' | 'invisible';

export interface OnlineStatusPayload {
  userId: string;
  status: string;
}

export interface OfflineStatusPayload {
  userId: string;
}

export interface StatusChangedPayload {
  userId: string;
  status: string;
  statusMessage: string | null;
}

/** One user's presence as returned by GET /api/users/presence. */
export interface UserPresence {
  status: string;
  statusMessage: string | null;
}

/** Avatar dot vocabulary — maps backend `away`→`idle` and `invisible`→`offline`. */
export type AvatarStatus = 'online' | 'idle' | 'dnd' | 'offline';

export function toAvatarStatus(status: string): AvatarStatus {
  switch (status) {
    case 'online':
      return 'online';
    case 'away':
      return 'idle';
    case 'dnd':
      return 'dnd';
    default:
      return 'offline'; // invisible, offline, unknown
  }
}
