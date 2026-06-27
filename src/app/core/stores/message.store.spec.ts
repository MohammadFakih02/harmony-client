import { TestBed } from '@angular/core/testing';
import { MessageStore } from './message.store';
import { MessageService } from '../services/message.service';
import { AuthService } from '../services/auth.service';
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

  beforeEach(() => {
    service = {
      getMessages: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
    };
    auth = {
      currentUser: vi.fn().mockReturnValue(AUTH_USER),
      getAccessToken: vi.fn().mockReturnValue('token'),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageStore,
        { provide: MessageService, useValue: service },
        { provide: AuthService, useValue: auth },
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

    it('replaces the pending entry with the real ID after REST response', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '500', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('hello'));

      const msgs = store.messages();
      const entry = msgs.find((m) => m.messageId === '500');
      expect(entry).toBeDefined();
      // A successful POST clears `pending` immediately (no longer waits for the
      // SignalR echo) — see message.store confirmSent().
      expect(entry?.pending).toBe(false);
      expect(store.realIdToTempId()['500']).toBeDefined();
    });

    it('marks the entry as failed when the REST call throws', async () => {
      service.sendMessage.mockRejectedValue(new Error('network'));

      await TestBed.runInInjectionContext(() => store.sendMessage('oops'));

      const failed = store.messages().find((m) => m.failed);
      expect(failed).toBeDefined();
      expect(failed?.content).toBe('oops');
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

      // The ids reach the service as `attachmentIds` (not the old singular field).
      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'look', {
        attachmentIds: ['42', '43'],
      });
    });

    it('sends attachmentIds=undefined when there are no attachments', async () => {
      service.sendMessage.mockResolvedValue({ messageId: '601', channelId: '1', guildId: '1' });

      await TestBed.runInInjectionContext(() => store.sendMessage('plain'));

      expect(service.sendMessage).toHaveBeenCalledWith('1', '1', 'plain', {
        attachmentIds: undefined,
      });
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
});
