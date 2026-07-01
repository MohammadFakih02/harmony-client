/** One member of a DM channel (everyone except the current user). */
export interface DmParticipant {
  userId: string;
  username: string;
  avatarKey: string | null;
}

/**
 * One DM channel from the current user's perspective. Unified across 1:1 and group:
 *   - isGroup=false → `participants` holds the single peer; `name` is null.
 *   - isGroup=true  → `participants` holds every other member; `name` is the group name
 *     (null/empty when unnamed — derive a label from the members).
 */
export interface DirectMessageChannel {
  channelId: string;
  isGroup: boolean;
  name: string | null;
  lastReadId: string;
  participants: DmParticipant[];
}

/** The single peer of a 1:1 DM (undefined for a group or an empty channel). */
export function dmPeer(dm: DirectMessageChannel | undefined): DmParticipant | undefined {
  return dm && !dm.isGroup ? dm.participants[0] : undefined;
}

/**
 * A human label for a DM: the group name (or the joined member names when unnamed) for a
 * group; the peer's display name for a 1:1. `displayName` lets the caller apply nickname
 * precedence (server/friend nicknames) per participant.
 */
export function dmLabel(
  dm: DirectMessageChannel,
  displayName: (p: DmParticipant) => string,
): string {
  if (dm.isGroup) {
    if (dm.name && dm.name.trim()) return dm.name.trim();
    const names = dm.participants.map(displayName);
    return names.length ? names.join(', ') : 'Group';
  }
  const peer = dm.participants[0];
  return peer ? displayName(peer) : 'Direct Message';
}
