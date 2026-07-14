import { TestBed } from '@angular/core/testing';
import { MessageStore } from './message.store';
import { MessageService } from '../services/message.service';
import { SignalRService } from '../services/signalr.service';
import { AuthService } from '../services/auth.service';
import { ReactionService } from '../services/reaction.service';
import { ToastService } from '../services/toast.service';
import { MessageResponse } from '../models/message.models';

const makeMsg = (overrides: Partial<MessageResponse> & { messageId: string }): MessageResponse => ({
  channelId: '1',
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

const AUTH_USER = { id: '10', username: 'alice', email: 'a@a.com', avatarKey: null, accountStatus: 'active' };

describe('MessageStore', () => {
  let store: InstanceType<typeof MessageStore>;
  let service: {
    getMessages: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
  };
  let auth: { currentUser: ReturnType<typeof vi.fn>; getAccessToken: ReturnType<typeof vi.fn> };
  let reactions: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  // Default disconnected so sends take the REST fallback; a test flips isConnected to exercise the hub.
  let signalr: { isConnected: boolean; sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = {
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
    };
    signalr = { isConnected: false, sendMessage: vi.fn() };
    auth = {
      currentUser: vi.fn().mockReturnValue(AUTH_USER),
      getAccessToken: vi.fn().mockReturnValue('token'),
    };
    reactions = {
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageStore,
        { provide: MessageService, useValue: service },
        { provide: SignalRService, useValue: signalr },
        { provide: AuthService, useValue: auth },
        { provide: ReactionService, useValue: reactions },
        { provide: ToastService, useValue: { info: vi.fn() } },
      ],
    });
    store = TestBed.inject(MessageStore);
  });

  it('starts empty', () => {
    expect(store.messages()).toEqual([]);
    expect(store.isLoading()).toBe(false);
    expect(store.degraded()).toBe(false);
  });

  describe('loadMessages()', () => {
    it('reverses the server order (newest-first → oldest-first for display)', async () => {
      service.getMessages.mockResolvedValue({
        messages: [makeMsg({ messageId: '3' }), makeMsg({ messageId: '2' }), makeMsg({ messageId: '1' })],
        degraded: false,
      });

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

      expect(store.messages().map((m) => m.messageId)).toEqual(['1', '2', '3']);
    });

    it('sets hasMore=false when fewer than 50 messages returned', async () => {
      service.getMessages.mockResolvedValue({ messages: [makeMsg({ messageId: '1' })], degraded: false });

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

      expect(store.hasMore()).toBe(false);
    });

    it('propagates the degraded flag', async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: true });

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

      expect(store.degraded()).toBe(true);
    });

    it('discards a stale response when the user switched channels mid-flight', async () => {
      let resolveA!: (v: unknown) => void;
      service.getMessages.mockImplementationOnce(() => new Promise((res) => (resolveA = res)));

      // Channel A starts loading but its response hangs…
      const loadA = TestBed.runInInjectionContext(() => store.loadMessages('1', 'A'));

      // …the user switches to channel B, which resolves first.
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: 'b1', channelId: 'B' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', 'B'));

      // A's late response must not clobber B's list.
      resolveA({ messages: [makeMsg({ messageId: 'a1', channelId: 'A' })], degraded: false });
      await loadA;

      expect(store.activeChannelId()).toBe('B');
      expect(store.messages().map((m) => m.messageId)).toEqual(['b1']);
      expect(store.isLoading()).toBe(false);
    });

    it('switching to an uncached channel clears the previous channel’s messages immediately', async () => {
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: 'a1', channelId: 'A' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', 'A'));

      let resolveB!: (v: unknown) => void;
      service.getMessages.mockImplementationOnce(() => new Promise((res) => (resolveB = res)));
      const load = TestBed.runInInjectionContext(() => store.loadMessages('1', 'B'));

      // A's content must never bleed into B's view while B is loading.
      expect(store.messages()).toEqual([]);

      resolveB({ messages: [], degraded: false });
      await load;
    });

    it('re-opening a channel paints its cached list instantly, then the fresh fetch replaces it', async () => {
      // Open A (fills the list), then switch to B (stashes A into the cache).
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: 'a1', channelId: 'A' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', 'A'));
      service.getMessages.mockResolvedValueOnce({ messages: [], degraded: false });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', 'B'));

      // Back to A: the cached message shows synchronously, before the fetch resolves.
      let resolveA!: (v: unknown) => void;
      service.getMessages.mockImplementationOnce(() => new Promise((res) => (resolveA = res)));
      const load = TestBed.runInInjectionContext(() => store.loadMessages('1', 'A'));
      expect(store.messages().map((m) => m.messageId)).toEqual(['a1']);

      // The fresh fetch stays authoritative and replaces the cached paint.
      resolveA({
        messages: [makeMsg({ messageId: 'a2', channelId: 'A' }), makeMsg({ messageId: 'a1', channelId: 'A' })],
        degraded: false,
      });
      await load;
      expect(store.messages().map((m) => m.messageId)).toEqual(['a1', 'a2']);
    });
  });

  describe('sendMessage() — optimistic flow', () => {
    beforeEach(async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
    });

    it('adds a pending optimistic entry immediately', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '999', channelId: '1', guildId: '1' });

      const sendPromise = TestBed.runInInjectionContext(() => store.sendMessage('hi'));

      // Check before the promise resolves
      const pending = store.messages().find((m) => m.pending);
      expect(pending).toBeDefined();
      expect(pending?.content).toBe('hi');

      await sendPromise;
    });

    it('replaces the pending entry with the real ID after REST response (socket down)', async () => {
      // Default harness: signalr.isConnected === false → REST fallback. No echo will arrive until
      // a reload, so confirmSent clears `pending` on the ack rather than strand the bubble grey.
      service.sendMessage.mockResolvedValue({ messageId: '500', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('hello'));

      const msgs = store.messages();
      const entry = msgs.find((m) => m.messageId === '500');
      expect(entry).toBeDefined();
      expect(entry?.pending).toBe(false);
      expect(store.realIdToTempId()['500']).toBeDefined();
    });

    it('keeps the bubble pending after the hub ack until the echo confirms persistence', async () => {
      // Socket up → an authoritative MessageReceived echo is coming, so publish-ack alone must NOT
      // un-grey the bubble (a Scylla-down send would otherwise look sent before it failed).
      signalr.isConnected = true;
      signalr.sendMessage.mockResolvedValue('501');

      await TestBed.runInInjectionContext(() => store.sendMessage('hello live'));

      const entry = store.messages().find((m) => m.messageId === '501');
      expect(entry?.pending).toBe(true);
      expect(store.realIdToTempId()['501']).toBeDefined();
    });

    it('marks the entry as failed when the REST call throws', async () => {
      service.sendMessage.mockRejectedValue(new Error('network'));

      await TestBed.runInInjectionContext(() => store.sendMessage('oops'));

      const failed = store.messages().find((m) => m.failed);
      expect(failed).toBeDefined();
      expect(failed?.content).toBe('oops');
    });

    it('captures the server reason (ProblemDetails detail) on a failed send', async () => {
      // A DM to a "friends_only" stranger 403s with a specific reason the composer surfaces.
      service.sendMessage.mockRejectedValue({
        status: 403,
        error: { detail: 'This user only accepts direct messages from friends.' },
      });

      await TestBed.runInInjectionContext(() => store.sendMessage('hey'));

      const failed = store.messages().find((m) => m.failed);
      expect(failed?.failedReason).toBe('This user only accepts direct messages from friends.');
    });

    it('carries attachment ids on the optimistic entry and forwards them to the service', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '600', channelId: '1', guildId: '1' });

      const sendPromise = TestBed.runInInjectionContext(() =>
        store.sendMessage('look', ['42', '43']),
      );

      // Optimistic entry shows the attachments before the POST resolves.
      const optimistic = store.messages().find((m) => m.pending);
      expect(optimistic?.attachmentIds).toEqual(['42', '43']);

      await sendPromise;

      // The ids reach the service as `attachmentIds` (not the old singular field), with a nonce.
      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'look', {
        attachmentIds: ['42', '43'],
        replyToId: undefined,
        nonce: expect.any(String),
      });
    });

    it('sends attachmentIds=undefined when there are no attachments', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '601', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('plain'));

      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'plain', {
        attachmentIds: undefined,
        replyToId: undefined,
        nonce: expect.any(String),
      });
    });

    it('sends via the hub (returning the persisted id) when the socket is connected', async () => {
      signalr.isConnected = true;
      signalr.sendMessage.mockResolvedValue('700');

      await TestBed.runInInjectionContext(() => store.sendMessage('over the wire'));

      expect(signalr.sendMessage).toHaveBeenCalledWith('1', '1', 'over the wire', {
        attachmentIds: undefined,
        replyToId: undefined,
        nonce: expect.any(String),
      });
      // REST is untouched, and the optimistic bubble adopts the hub-returned id (still pending
      // until the echo confirms persistence — see confirmSent()).
      expect(service.sendMessage).not.toHaveBeenCalled();
      expect(store.messages().some((m) => m.messageId === '700')).toBe(true);
    });
  });

  describe('appendMessage() — reconcile', () => {
    beforeEach(async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      service.sendMessage.mockResolvedValue({ messageId: '777', channelId: '1', guildId: '1' });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      await TestBed.runInInjectionContext(() => store.sendMessage('sent'));
    });

    it('reconciles a pending entry when SignalR fires with the real ID', () => {
      const authoritative = makeMsg({ messageId: '777', content: 'sent', username: 'alice' });

      store.appendMessage(authoritative);

      const msgs = store.messages();
      const reconciled = msgs.find((m) => m.messageId === '777');
      expect(reconciled?.pending).toBeUndefined();
      expect(store.realIdToTempId()['777']).toBeUndefined();
    });

    it('appends a genuinely new message without touching pending entries', () => {
      const other = makeMsg({ messageId: '888', content: 'hi from bob', userId: '99', username: 'bob' });

      store.appendMessage(other);

      expect(store.messages().some((m) => m.messageId === '888')).toBe(true);
      // Original pending entry still there
      expect(store.messages().some((m) => m.messageId === '777')).toBe(true);
    });

    it('does not append duplicate messages', () => {
      const msg = makeMsg({ messageId: '888', content: 'once' });
      store.appendMessage(msg);
      store.appendMessage(msg);

      expect(store.messages().filter((m) => m.messageId === '888')).toHaveLength(1);
    });

    it('reconciles by nonce when the echo arrives before the send resolves (no duplicate)', async () => {
      // Hold the send open so the live echo can beat the ack (the ordering the nonce guards against).
      let resolveSend!: () => void;
      service.sendMessage.mockReturnValue(
        new Promise((res) => {
          resolveSend = () => res({ messageId: '901', channelId: '1', guildId: '1' });
        }),
      );

      const sendPromise = TestBed.runInInjectionContext(() => store.sendMessage('racy'));
      const optimistic = store.messages().find((m) => m.pending);
      expect(optimistic?.nonce).toBeDefined();

      // The authoritative echo (carrying the same nonce) lands first.
      store.appendMessage(makeMsg({ messageId: '901', content: 'racy', nonce: optimistic!.nonce }));

      // Replaced in place: exactly one copy, real id, no longer pending.
      const matches = store.messages().filter((m) => m.messageId === '901');
      expect(matches).toHaveLength(1);
      expect(matches[0].pending).toBeUndefined();
      expect(store.messages().some((m) => m.pending)).toBe(false);

      // The late ack must not resurrect a duplicate.
      resolveSend();
      await sendPromise;
      expect(store.messages().filter((m) => m.messageId === '901')).toHaveLength(1);
    });
  });

  describe('trimToWindow()', () => {
    it('is a no-op at or under the cap', async () => {
      service.getMessages.mockResolvedValue({
        messages: Array.from({ length: 50 }, (_, i) => makeMsg({ messageId: String(i) })),
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

      store.trimToWindow();

      expect(store.messages()).toHaveLength(50);
    });

    it('keeps the most recent 200 and flags hasMore when over the cap', async () => {
      // 250 loaded (e.g. after scroll-back), oldest-first. loadMessages sets hasMore=false (<50 rule),
      // so this also proves the trim re-opens older-history loading.
      service.getMessages.mockResolvedValue({
        messages: Array.from({ length: 250 }, (_, i) => makeMsg({ messageId: String(i) })).reverse(),
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      expect(store.messages()).toHaveLength(250);

      store.trimToWindow();

      const msgs = store.messages();
      expect(msgs).toHaveLength(200);
      // Oldest 50 dropped; the newest message is retained.
      expect(msgs[0].messageId).toBe('50');
      expect(msgs[msgs.length - 1].messageId).toBe('249');
      expect(store.hasMore()).toBe(true);
    });
  });

  describe('handleFailed()', () => {
    it('marks the message as failed by messageId', async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      service.sendMessage.mockResolvedValue({ messageId: '321', channelId: '1', guildId: '1' });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      await TestBed.runInInjectionContext(() => store.sendMessage('will fail'));

      store.handleFailed({ messageId: '321', channelId: '1', guildId: '1' });

      const msg = store.messages().find((m) => m.messageId === '321');
      expect(msg?.failed).toBe(true);
      expect(msg?.pending).toBe(false);
    });
  });

  describe('retryMessage()', () => {
    it('re-sends a failed message and reconciles on success', async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      service.sendMessage
        .mockRejectedValueOnce(new Error('first attempt fails'))
        .mockResolvedValueOnce({ messageId: '456', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      await TestBed.runInInjectionContext(() => store.sendMessage('retry me'));

      const failedEntry = store.messages().find((m) => m.failed);
      expect(failedEntry).toBeDefined();
      const originalTempId = failedEntry!.tempId!;

      await TestBed.runInInjectionContext(() => store.retryMessage(originalTempId));

      // Original failed entry is gone; new pending entry exists with realId=456
      expect(store.messages().find((m) => m.failed)).toBeUndefined();
      expect(store.messages().find((m) => m.messageId === '456')).toBeDefined();
    });

    it('marks the entry failed again if the retry also throws', async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      service.sendMessage.mockRejectedValue(new Error('always fails'));

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      await TestBed.runInInjectionContext(() => store.sendMessage('doomed'));

      const failed = store.messages().find((m) => m.failed)!;
      await TestBed.runInInjectionContext(() => store.retryMessage(failed.tempId!));

      expect(store.messages().find((m) => m.failed)).toBeDefined();
    });

    it('is a no-op when called with an unknown tempId', async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

      await TestBed.runInInjectionContext(() => store.retryMessage(-9999));

      expect(service.sendMessage).not.toHaveBeenCalled();
    });
  });

  it('clearMessages() resets all state', async () => {
    service.getMessages.mockResolvedValue({
      messages: [makeMsg({ messageId: '1' })],
      degraded: false,
    });
    await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));

    store.clearMessages();

    expect(store.messages()).toEqual([]);
    expect(store.activeChannelId()).toBeNull();
  });

  describe('mention highlights', () => {
    it('seeds highlights for unread-block messages that mention me', async () => {
      // newest-first from the API → oldest-first in the store: [1, 2, 3]
      service.getMessages.mockResolvedValue({
        messages: [
          makeMsg({ messageId: '3', mentionIds: ['10'] }), // unread + mentions me
          makeMsg({ messageId: '2', mentionIds: [] }), // unread, no mention
          makeMsg({ messageId: '1', mentionIds: ['10'] }), // already read (below boundary)
        ],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      store.setUnreadOnOpen(2); // last two (ids 2,3) are unread

      store.seedMentionHighlights();

      expect(store.isMentionHighlight('3')).toBe(true);
      expect(store.isMentionHighlight('2')).toBe(false);
      expect(store.isMentionHighlight('1')).toBe(false); // read mention isn't highlighted
    });

    it('loadMessages clears prior highlights', async () => {
      service.getMessages.mockResolvedValue({
        messages: [makeMsg({ messageId: '3', mentionIds: ['10'] })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
      store.setUnreadOnOpen(1);
      store.seedMentionHighlights();
      expect(store.isMentionHighlight('3')).toBe(true);

      await TestBed.runInInjectionContext(() => store.loadMessages('1', '2'));
      expect(store.isMentionHighlight('3')).toBe(false);
    });

    it('appendMessage highlights a live message that mentions me, not others', () => {
      store.appendMessage(makeMsg({ messageId: '20', userId: '99', mentionIds: ['10'] }));
      store.appendMessage(makeMsg({ messageId: '21', userId: '99', mentionIds: [] }));

      expect(store.isMentionHighlight('20')).toBe(true);
      expect(store.isMentionHighlight('21')).toBe(false);
    });
  });

  describe('reply target', () => {
    beforeEach(async () => {
      service.getMessages.mockResolvedValue({ messages: [], degraded: false });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
    });

    it('sets and clears the reply target', () => {
      expect(store.replyTarget()).toBeNull();

      store.setReplyTarget({ messageId: '42', authorName: 'bob', content: 'hi' });
      expect(store.replyTarget()?.messageId).toBe('42');

      store.clearReplyTarget();
      expect(store.replyTarget()).toBeNull();
    });

    it('forwards replyToId to the service and sets it on the optimistic message', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '700', channelId: '1', guildId: '1' });

      const sendPromise = TestBed.runInInjectionContext(() =>
        store.sendMessage('a reply', [], '42'),
      );

      const optimistic = store.messages().find((m) => m.pending);
      expect(optimistic?.replyToId).toBe('42');

      await sendPromise;

      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'a reply', {
        attachmentIds: undefined,
        replyToId: '42',
        nonce: expect.any(String),
      });
    });

    it('sends replyToId=undefined when not replying', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '701', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('plain'));

      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'plain', {
        attachmentIds: undefined,
        replyToId: undefined,
        nonce: expect.any(String),
      });
    });

    it('preserves replyToId across a retry', async () => {
      service.sendMessage
        .mockRejectedValueOnce(new Error('fails'))
        .mockResolvedValueOnce({ messageId: '702', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('reply that fails', [], '42'));
      const failed = store.messages().find((m) => m.failed)!;
      expect(failed.replyToId).toBe('42');

      await TestBed.runInInjectionContext(() => store.retryMessage(failed.tempId!));

      expect(service.sendMessage).toHaveBeenLastCalledWith('1', '1', 'reply that fails', {
        attachmentIds: undefined,
        replyToId: '42',
        nonce: expect.any(String),
      });
    });

    it('clearMessages resets the reply target', () => {
      store.setReplyTarget({ messageId: '42', authorName: 'bob', content: 'hi' });
      store.clearMessages();
      expect(store.replyTarget()).toBeNull();
    });
  });

  describe('anchored history mode (jump to old message)', () => {
    it('jumpToMessage loads the around window, enters anchored mode, and requests a jump', async () => {
      service.getMessages.mockResolvedValue({
        messages: [makeMsg({ messageId: '105' }), makeMsg({ messageId: '100' }), makeMsg({ messageId: '95' })],
        degraded: false,
      });

      await TestBed.runInInjectionContext(() => store.jumpToMessage('1', '1', '100'));

      expect(service.getMessages).toHaveBeenCalledWith('1', '1', { around: '100' });
      // reversed to oldest-first for display
      expect(store.messages().map((m) => m.messageId)).toEqual(['95', '100', '105']);
      expect(store.anchored()).toBe(true);
      expect(store.jumpRequest()?.messageId).toBe('100');
    });

    it('suppresses live appends while anchored (no viewport yank)', async () => {
      service.getMessages.mockResolvedValue({
        messages: [makeMsg({ messageId: '100' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.jumpToMessage('1', '1', '100'));

      store.appendMessage(makeMsg({ messageId: '999', userId: '55' }));

      expect(store.messages().map((m) => m.messageId)).toEqual(['100']);
    });

    it('loadNewer appends and stays anchored on a full page', async () => {
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: '100' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.jumpToMessage('1', '1', '100'));

      const fullPage = Array.from({ length: 50 }, (_, i) => makeMsg({ messageId: String(200 + i) }));
      service.getMessages.mockResolvedValueOnce({ messages: fullPage, degraded: false });

      await TestBed.runInInjectionContext(() => store.loadNewer());

      expect(service.getMessages).toHaveBeenLastCalledWith('1', '1', { after: '100' });
      expect(store.messages().length).toBe(51);
      expect(store.anchored()).toBe(true);
    });

    it('loadNewer clears anchored mode when it reaches the tail (short page)', async () => {
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: '100' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.jumpToMessage('1', '1', '100'));

      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: '101' }), makeMsg({ messageId: '102' })],
        degraded: false,
      });

      await TestBed.runInInjectionContext(() => store.loadNewer());

      expect(store.anchored()).toBe(false);
    });

    it('jumpToPresent reloads the latest page and leaves anchored mode', async () => {
      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: '100' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.jumpToMessage('1', '1', '100'));
      expect(store.anchored()).toBe(true);

      service.getMessages.mockResolvedValueOnce({
        messages: [makeMsg({ messageId: '500' }), makeMsg({ messageId: '499' })],
        degraded: false,
      });

      await TestBed.runInInjectionContext(() => store.jumpToPresent());

      expect(store.anchored()).toBe(false);
      expect(store.messages().map((m) => m.messageId)).toEqual(['499', '500']);
    });

    it('consumePendingJump returns and clears a matching parked jump; null otherwise', () => {
      store.requestChannelJump('7', '42', '900');
      expect(store.consumePendingJump('99')).toBeNull(); // different channel
      const consumed = store.consumePendingJump('42');
      expect(consumed).toEqual({ guildId: '7', channelId: '42', messageId: '900' });
      expect(store.consumePendingJump('42')).toBeNull(); // already consumed
    });
  });

  describe('reactions', () => {
    beforeEach(async () => {
      // A single settled message from someone else, no reactions yet.
      service.getMessages.mockResolvedValue({
        messages: [makeMsg({ messageId: '50', userId: '99', username: 'bob' })],
        degraded: false,
      });
      await TestBed.runInInjectionContext(() => store.loadMessages('1', '1'));
    });

    const msgOf = (id: string) => store.messages().find((m) => m.messageId === id)!;
    const pill = (id: string, emoji: string) => msgOf(id).reactions?.find((r) => r.emoji === emoji);

    it('adds optimistically and calls the add endpoint', async () => {
      const p = TestBed.runInInjectionContext(() => store.toggleReaction(msgOf('50'), '😀'));
      // Optimistic pill lands before the POST resolves.
      expect(pill('50', '😀')).toEqual({ emoji: '😀', count: 1, meReacted: true });
      await p;
      expect(reactions.add).toHaveBeenCalledWith('1', '1', '50', '😀');
    });

    it('toggling an already-mine emoji removes it and calls the remove endpoint', async () => {
      await TestBed.runInInjectionContext(() => store.toggleReaction(msgOf('50'), '😀'));
      expect(pill('50', '😀')?.meReacted).toBe(true);

      await TestBed.runInInjectionContext(() => store.toggleReaction(msgOf('50'), '😀'));
      expect(pill('50', '😀')).toBeUndefined(); // dropped at count 0
      expect(reactions.remove).toHaveBeenCalledWith('1', '1', '50', '😀');
    });

    it('reverts the optimistic add when the service rejects', async () => {
      reactions.add.mockRejectedValueOnce(new Error('nope'));
      await TestBed.runInInjectionContext(() => store.toggleReaction(msgOf('50'), '😀'));
      expect(pill('50', '😀')).toBeUndefined();
    });

    it('a foreign ReactionAdded bumps the count without flipping meReacted', () => {
      store.reactionAdded({ messageId: '50', channelId: '1', guildId: '1', emoji: '🔥', userId: '77' });
      expect(pill('50', '🔥')).toEqual({ emoji: '🔥', count: 1, meReacted: false });

      store.reactionAdded({ messageId: '50', channelId: '1', guildId: '1', emoji: '🔥', userId: '88' });
      expect(pill('50', '🔥')?.count).toBe(2);
    });

    it('ReactionRemoved drops the pill when the last reactor leaves', () => {
      store.reactionAdded({ messageId: '50', channelId: '1', guildId: '1', emoji: '🔥', userId: '77' });
      store.reactionRemoved({ messageId: '50', channelId: '1', guildId: '1', emoji: '🔥', userId: '77' });
      expect(pill('50', '🔥')).toBeUndefined();
    });

    it('does not double-count my own echo after an optimistic add', async () => {
      await TestBed.runInInjectionContext(() => store.toggleReaction(msgOf('50'), '😀'));
      expect(pill('50', '😀')?.count).toBe(1);

      // The server echoes my own reaction back — must be a no-op (guarded on meReacted).
      store.reactionAdded({ messageId: '50', channelId: '1', guildId: '1', emoji: '😀', userId: '10' });
      expect(pill('50', '😀')).toEqual({ emoji: '😀', count: 1, meReacted: true });
    });

    it('ignores toggles on optimistic (pending) messages', async () => {
      service.sendMessage.mockImplementation(() => new Promise(() => {})); // never resolves
      TestBed.runInInjectionContext(() => store.sendMessage('pending'));
      const pendingMsg = store.messages().find((m) => m.pending)!;

      await TestBed.runInInjectionContext(() => store.toggleReaction(pendingMsg, '😀'));

      expect(reactions.add).not.toHaveBeenCalled();
    });
  });
});
