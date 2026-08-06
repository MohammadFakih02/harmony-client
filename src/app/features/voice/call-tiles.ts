import { VoiceParticipant } from '../../core/models/voice.models';

/**
 * One box in a call grid: every participant gets a camera/avatar tile, and a screensharing
 * participant gets an additional dedicated stream tile (Discord-style — camera and screen never
 * fight for one box). Ids are stable (`userId` / `userId:screen`) so `@for` tracking and the
 * overlay's focused-tile reference survive roster updates.
 */
export interface CallTile {
  id: string;
  userId: string;
  kind: 'camera' | 'screen';
}

/** Derives the tile list for a roster — camera tiles in join order, each screen tile after its owner's. */
export function buildTiles(participants: readonly VoiceParticipant[]): CallTile[] {
  const tiles: CallTile[] = [];
  for (const p of [...participants].sort((a, b) => a.joinedAt - b.joinedAt)) {
    tiles.push({ id: p.userId, userId: p.userId, kind: 'camera' });
    if (p.isStreaming) tiles.push({ id: `${p.userId}:screen`, userId: p.userId, kind: 'screen' });
  }
  return tiles;
}
