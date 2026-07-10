import { VoiceParticipant } from '../../core/models/voice.models';
import { buildTiles } from './call-tiles';

function participant(over: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    channelId: 'c1',
    guildId: 'g1',
    userId: 'u1',
    isMuted: false,
    isDeafened: false,
    isVideoOn: false,
    isStreaming: false,
    joinedAt: 1,
    ...over,
  };
}

describe('buildTiles', () => {
  it('returns an empty list for an empty roster', () => {
    expect(buildTiles([])).toEqual([]);
  });

  it('gives every participant one camera tile, in join order', () => {
    const tiles = buildTiles([
      participant({ userId: 'u2', joinedAt: 2 }),
      participant({ userId: 'u1', joinedAt: 1 }),
    ]);

    expect(tiles).toEqual([
      { id: 'u1', userId: 'u1', kind: 'camera' },
      { id: 'u2', userId: 'u2', kind: 'camera' },
    ]);
  });

  it('adds a dedicated screen tile right after a streaming participant', () => {
    const tiles = buildTiles([
      participant({ userId: 'u1', joinedAt: 1, isStreaming: true }),
      participant({ userId: 'u2', joinedAt: 2 }),
    ]);

    expect(tiles.map((t) => t.id)).toEqual(['u1', 'u1:screen', 'u2']);
    expect(tiles[1]).toEqual({ id: 'u1:screen', userId: 'u1', kind: 'screen' });
  });

  it('camera-on alone adds no extra tile (video renders inside the camera tile)', () => {
    const tiles = buildTiles([participant({ userId: 'u1', isVideoOn: true })]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].kind).toBe('camera');
  });

  it('does not mutate the input roster order', () => {
    const roster = [
      participant({ userId: 'u2', joinedAt: 2 }),
      participant({ userId: 'u1', joinedAt: 1 }),
    ];
    buildTiles(roster);
    expect(roster.map((p) => p.userId)).toEqual(['u2', 'u1']);
  });
});
