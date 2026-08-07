import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { BootstrapCacheDb } from './bootstrap-cache.db';
import type { BootstrapResponse } from './bootstrap.service';

// Dexie freezes its indexedDB dependency at module-load; if another spec in this worker imported
// Dexie before fake-indexeddb/auto ran, that reference is null. Re-point it at the fake now.
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const makePayload = (guildName: string): BootstrapResponse => ({
  profile: {
    preferredStatus: 'online',
    statusMessage: null,
    preferredStatusExpiresAt: null,
    statusMessageExpiresAt: null,
  },
  guilds: [{ id: '1', name: guildName }] as BootstrapResponse['guilds'],
  unread: [],
  friends: [],
  pendingFriends: [],
  dms: [],
  nicknames: {},
  notifications: [],
  notificationUnreadCount: 0,
});

describe('BootstrapCacheDb', () => {
  let cache: BootstrapCacheDb;

  beforeAll(() => {
    cache = new BootstrapCacheDb();
  });

  beforeEach(async () => {
    await cache.clear();
  });

  it('reports enabled under a real IndexedDB', () => {
    expect(cache.enabled).toBe(true);
  });

  it('returns null on a miss', async () => {
    expect(await cache.read('u1')).toBeNull();
  });

  it('round-trips the payload for the owning user', async () => {
    const payload = makePayload('Mine');
    await cache.write('u1', payload);

    expect(await cache.read('u1')).toEqual(payload);
  });

  it('never returns another user’s snapshot (the userId read-guard)', async () => {
    await cache.write('u1', makePayload('Alice'));

    expect(await cache.read('u2')).toBeNull();
  });

  it('keeps a single row — a new write overwrites the previous user’s snapshot', async () => {
    await cache.write('u1', makePayload('Alice'));
    await cache.write('u2', makePayload('Bob'));

    expect(await cache.read('u1')).toBeNull(); // u1's row is gone
    expect((await cache.read('u2'))?.guilds[0].name).toBe('Bob');
  });

  it('clear() empties the snapshot', async () => {
    await cache.write('u1', makePayload('Alice'));
    await cache.clear();

    expect(await cache.read('u1')).toBeNull();
  });
});
