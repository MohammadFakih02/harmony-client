import { DirectMessageChannel, dmLabel, dmPeer } from './direct-message.models';

const oneToOne: DirectMessageChannel = {
  channelId: 'c1',
  isGroup: false,
  name: null,
  iconKey: null,
  lastReadId: '0',
  participants: [{ userId: 'u1', username: 'alice', avatarKey: null }],
};

const namedGroup: DirectMessageChannel = {
  channelId: 'c2',
  isGroup: true,
  name: 'Squad',
  iconKey: null,
  lastReadId: '0',
  participants: [
    { userId: 'u1', username: 'alice', avatarKey: null },
    { userId: 'u2', username: 'bob', avatarKey: null },
  ],
};

const unnamedGroup: DirectMessageChannel = { ...namedGroup, channelId: 'c3', name: null };

describe('direct-message model helpers', () => {
  describe('dmPeer', () => {
    it('returns the single peer of a 1:1 DM', () => {
      expect(dmPeer(oneToOne)?.username).toBe('alice');
    });

    it('returns undefined for a group', () => {
      expect(dmPeer(namedGroup)).toBeUndefined();
    });

    it('returns undefined for an undefined channel', () => {
      expect(dmPeer(undefined)).toBeUndefined();
    });
  });

  describe('dmLabel', () => {
    const name = (p: { username: string }) => p.username;

    it('uses the 1:1 peer name', () => {
      expect(dmLabel(oneToOne, name)).toBe('alice');
    });

    it('uses the group name when set', () => {
      expect(dmLabel(namedGroup, name)).toBe('Squad');
    });

    it('joins member names when the group is unnamed', () => {
      expect(dmLabel(unnamedGroup, name)).toBe('alice, bob');
    });

    it('applies the display-name mapper (e.g. nicknames)', () => {
      const nick = (p: { userId: string; username: string }) =>
        p.userId === 'u1' ? 'Ally' : p.username;
      expect(dmLabel(unnamedGroup, nick)).toBe('Ally, bob');
    });
  });
});
