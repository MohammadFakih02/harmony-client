import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { MessageCacheCore } from './message-cache.core';
import { MessageResponse } from '../models/message.models';

// Dexie freezes its indexedDB dependency at module-load; if another spec in this worker imported
// Dexie before fake-indexeddb/auto ran, that reference is null. Re-point it at the fake now.
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const makeMsg = (overrides: Partial<MessageResponse> & { messageId: string }): MessageResponse => ({
  channelId: 'C',
  guildId: '1',
  userId: '10',
  username: 'alice',
  avatarKey: null,
  content: 'hello',
  sentAt: Date.now(),
  isEdited: false,
  editedAt: null,
  isDeleted: false,
  messageType: 'Default',
  attachmentIds: [],
  mentionIds: [],
  replyToId: null,
  ...overrides,
});

const ids = (msgs: readonly MessageResponse[]): string[] => msgs.map((m) => m.messageId);

// The storage engine (message-cache.core) runs inside the Web Worker in the browser; here we exercise it
// directly on the main thread under fake-indexeddb — the worker is a thin Comlink pass-through over it.
describe('MessageCacheCore', () => {
  let cache: MessageCacheCore;

  beforeAll(() => {
    cache = new MessageCacheCore();
  });

  beforeEach(async () => {
    await cache.clearAll();
  });

  it('reports enabled under a real IndexedDB', () => {
    expect(cache.enabled).toBe(true);
  });

  it('round-trips messages ascending by snowflake regardless of insert order', async () => {
    await cache.putMessages('C', [makeMsg({ messageId: '3' }), makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' })]);

    expect(ids(await cache.loadChannel('C'))).toEqual(['1', '2', '3']);
  });

  it('returns [] for an unknown channel', async () => {
    expect(await cache.loadChannel('nope')).toEqual([]);
  });

  it('keeps channels isolated', async () => {
    await cache.putMessages('A', [makeMsg({ channelId: 'A', messageId: '1' })]);
    await cache.putMessages('B', [makeMsg({ channelId: 'B', messageId: '2' })]);

    expect(ids(await cache.loadChannel('A'))).toEqual(['1']);
    expect(ids(await cache.loadChannel('B'))).toEqual(['2']);
  });

  it('loadChannel caps to the newest N', async () => {
    await cache.putMessages(
      'C',
      Array.from({ length: 10 }, (_, i) => makeMsg({ messageId: String(i + 1) })),
    );

    expect(ids(await cache.loadChannel('C', 3))).toEqual(['8', '9', '10']);
  });

  it('never persists optimistic / failed bubbles', async () => {
    await cache.putMessages('C', [
      makeMsg({ messageId: '1' }),
      { ...makeMsg({ messageId: '-2' }), tempId: -2, pending: true },
      { ...makeMsg({ messageId: '-3' }), tempId: -3, failed: true },
    ]);

    expect(ids(await cache.loadChannel('C'))).toEqual(['1']);
  });

  it('strips client-only fields before persisting', async () => {
    await cache.putMessages('C', [{ ...makeMsg({ messageId: '1' }), nonce: 'abc', failedReason: 'x' }]);

    const [row] = await cache.loadChannel('C');
    expect('nonce' in row).toBe(false);
    expect('failedReason' in row).toBe(false);
    expect('tempId' in row).toBe(false);
  });

  it('upserts by identity — re-putting an edited message overwrites it', async () => {
    await cache.putMessages('C', [makeMsg({ messageId: '1', content: 'before' })]);
    await cache.putMessages('C', [makeMsg({ messageId: '1', content: 'after' })]);

    const rows = await cache.loadChannel('C');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('after');
  });

  it('evicts down to the per-channel cap, keeping the newest', async () => {
    await cache.putMessages(
      'C',
      Array.from({ length: 600 }, (_, i) => makeMsg({ messageId: String(i + 1) })),
    );

    const all = await cache.loadChannel('C', 10_000);
    expect(all).toHaveLength(500);
    // Oldest 100 dropped; newest retained.
    expect(all[0].messageId).toBe('101');
    expect(all[all.length - 1].messageId).toBe('600');
  });

  it('clearChannel removes a channel entirely', async () => {
    await cache.putMessages('C', [makeMsg({ messageId: '1' })]);
    await cache.clearChannel('C');

    expect(await cache.loadChannel('C')).toEqual([]);
  });
});
