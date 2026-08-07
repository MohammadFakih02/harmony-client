import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { TestBed } from '@angular/core/testing';
import { MessageStore, mergeLatest } from './message.store';

// See message-cache.db.spec.ts: re-point Dexie at the fake IndexedDB in case it loaded first.
Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;
import { MessageCacheDb } from '../services/message-cache.db';
import { MessageService } from '../services/message.service';
import { SignalRService } from '../services/signalr.service';
import { AuthService } from '../services/auth.service';
import { ReactionService } from '../services/reaction.service';
import { ToastService } from '../services/toast.service';
import { FileStore } from './file.store';
import { MessageResponse } from '../models/message.models';

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
const AUTH_USER = { id: '10', username: 'alice', email: 'a@a.com', avatarKey: null, accountStatus: 'active' };

// ─── The pure merge, tested without any IndexedDB ───────────────────────────────────────────────
describe('mergeLatest()', () => {
  it('returns the latest page as-is when there is no cache', () => {
    const latest = [makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' })];
    expect(mergeLatest([], latest)).toEqual({ messages: latest, hasMore: false });
  });

  it('flags hasMore when the latest page is full (50)', () => {
    const latest = Array.from({ length: 50 }, (_, i) => makeMsg({ messageId: String(i + 1) }));
    expect(mergeLatest([], latest).hasMore).toBe(true);
  });

  it('unions a contiguous cached prefix below the latest page (server wins the overlap)', () => {
    const base = [makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' }), makeMsg({ messageId: '3', content: 'stale' })];
    const latest = [makeMsg({ messageId: '3', content: 'fresh' }), makeMsg({ messageId: '4' })];

    const { messages } = mergeLatest(base, latest);
    expect(ids(messages)).toEqual(['1', '2', '3', '4']);
    expect(messages.find((m) => m.messageId === '3')?.content).toBe('fresh');
  });

  it('preserves a cached suffix newer than the whole latest page (a live message that beat the fetch)', () => {
    const base = [makeMsg({ messageId: '3' }), makeMsg({ messageId: '9' })];
    const latest = [makeMsg({ messageId: '3' }), makeMsg({ messageId: '4' })];

    expect(ids(mergeLatest(base, latest).messages)).toEqual(['3', '4', '9']);
  });

  it('drops a stale cache on a gap bigger than one page, keeping only the latest window', () => {
    const base = [makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' })];
    const latest = Array.from({ length: 50 }, (_, i) => makeMsg({ messageId: String(100 + i) }));

    const { messages, hasMore } = mergeLatest(base, latest);
    expect(messages.some((m) => m.messageId === '1')).toBe(false);
    expect(messages).toHaveLength(50);
    expect(hasMore).toBe(true);
  });

  it('caps the merged window to 200 and flags hasMore', () => {
    const base = Array.from({ length: 300 }, (_, i) => makeMsg({ messageId: String(i + 1) }));
    const latest = [makeMsg({ messageId: '300' }), makeMsg({ messageId: '301' })];

    const { messages, hasMore } = mergeLatest(base, latest);
    expect(messages).toHaveLength(200);
    expect(messages[messages.length - 1].messageId).toBe('301');
    expect(hasMore).toBe(true);
  });
});

// ─── The store's local-first open, against a real (fake-indexeddb) cache ─────────────────────────
describe('MessageStore local-first cache', () => {
  let store: InstanceType<typeof MessageStore>;
  let cache: MessageCacheDb;
  let service: { getMessages: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn>; markRead: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageStore,
        { provide: MessageService, useValue: service },
        { provide: SignalRService, useValue: { isConnected: false, sendMessage: vi.fn() } },
        { provide: AuthService, useValue: { currentUser: vi.fn().mockReturnValue(AUTH_USER), getAccessToken: vi.fn().mockReturnValue('t') } },
        { provide: ReactionService, useValue: { add: vi.fn(), remove: vi.fn() } },
        { provide: ToastService, useValue: { info: vi.fn() } },
        { provide: FileStore, useValue: { resolveMany: vi.fn().mockResolvedValue(undefined) } },
      ],
    });
    store = TestBed.inject(MessageStore);
    cache = TestBed.inject(MessageCacheDb);
    await cache.clearAll();
  });

  it('is enabled under fake-indexeddb', () => {
    expect(cache.enabled).toBe(true);
  });

  it('cold-opens from IndexedDB and merges the fetched page (cached prefix survives)', async () => {
    // Simulate a prior session having persisted three messages for this channel.
    await cache.putMessages('C', [makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' }), makeMsg({ messageId: '3' })]);

    // The live fetch returns the newest window (newest-first, as the API does).
    service.getMessages.mockResolvedValue({ messages: [makeMsg({ messageId: '4' }), makeMsg({ messageId: '3' })], degraded: false });

    await TestBed.runInInjectionContext(() => store.loadMessages('1', 'C'));

    // If the IDB hydrate hadn't fed the merge, this would be just ['3','4'].
    expect(ids(store.messages())).toEqual(['1', '2', '3', '4']);
  });

  it('keeps only the latest page when the cache is far behind (gap)', async () => {
    await cache.putMessages('C', [makeMsg({ messageId: '1' }), makeMsg({ messageId: '2' })]);
    const page = Array.from({ length: 50 }, (_, i) => makeMsg({ messageId: String(100 + i) })).reverse();
    service.getMessages.mockResolvedValue({ messages: page, degraded: false });

    await TestBed.runInInjectionContext(() => store.loadMessages('1', 'C'));

    expect(store.messages().some((m) => m.messageId === '1')).toBe(false);
    expect(store.messages()).toHaveLength(50);
    expect(store.hasMore()).toBe(true);
  });

  it('persists a live appended message so a later cold open sees it', async () => {
    service.getMessages.mockResolvedValue({ messages: [], degraded: false });
    await TestBed.runInInjectionContext(() => store.loadMessages('1', 'C'));

    store.appendMessage(makeMsg({ messageId: '77', userId: '99' }));

    // Wait past the 250ms persist debounce, then read the cache back directly.
    await new Promise((r) => setTimeout(r, 320));
    const persisted = await cache.loadChannel('C');
    expect(persisted.some((m) => m.messageId === '77')).toBe(true);
  });
});
