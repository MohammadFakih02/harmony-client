import { TestBed } from '@angular/core/testing';
import { PinStore } from './pin.store';
import { MessageService } from '../services/message.service';
import { AuthService } from '../services/auth.service';
import { MessageResponse, PinnedMessageResponse } from '../models/message.models';

function msg(id: string, over: Partial<MessageResponse> = {}): MessageResponse {
  return {
    messageId: id,
    channelId: 'c1',
    guildId: 'g1',
    userId: 'u1',
    username: 'alice',
    avatarKey: null,
    content: 'hi',
    sentAt: 1,
    isEdited: false,
    editedAt: null,
    isDeleted: false,
    messageType: 'text',
    attachmentIds: [],
    mentionIds: [],
    replyToId: null,
    ...over,
  };
}

function pin(id: string): PinnedMessageResponse {
  return { message: msg(id), pinnedBy: 'me', pinnedAt: id };
}

describe('PinStore', () => {
  let service: {
    getPins: ReturnType<typeof vi.fn>;
    pinMessage: ReturnType<typeof vi.fn>;
    unpinMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getPins: vi.fn().mockResolvedValue([]),
      pinMessage: vi.fn().mockResolvedValue(undefined),
      unpinMessage: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        PinStore,
        { provide: MessageService, useValue: service },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      ],
    });
  });

  it('load() populates pins + pinnedIds', async () => {
    service.getPins.mockResolvedValue([pin('1'), pin('2')]);
    const store = TestBed.inject(PinStore);

    await store.load('g1', 'c1');

    expect(service.getPins).toHaveBeenCalledWith('g1', 'c1');
    expect(store.pins().length).toBe(2);
    expect(store.pinnedIds().has('1')).toBe(true);
  });

  it('pin() optimistically prepends and calls the service', async () => {
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    await store.pin('g1', 'c1', msg('9'));

    expect(service.pinMessage).toHaveBeenCalledWith('g1', 'c1', '9');
    expect(store.pinnedIds().has('9')).toBe(true);
  });

  it('pin() reverts on failure', async () => {
    service.pinMessage.mockRejectedValue(new Error('nope'));
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    await store.pin('g1', 'c1', msg('9'));

    expect(store.pinnedIds().has('9')).toBe(false);
  });

  it('unpin() optimistically removes the pin', async () => {
    service.getPins.mockResolvedValue([pin('1')]);
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    await store.unpin('g1', 'c1', '1');

    expect(service.unpinMessage).toHaveBeenCalledWith('g1', 'c1', '1');
    expect(store.pinnedIds().has('1')).toBe(false);
  });

  it('applyPinned() reloads when another user pins in the active channel', async () => {
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1'); // initial → []
    service.getPins.mockResolvedValue([pin('5')]);

    await store.applyPinned('c1', '5');

    expect(store.pinnedIds().has('5')).toBe(true);
  });

  it('applyPinned() ignores our own echo (id already present)', async () => {
    service.getPins.mockResolvedValue([pin('1')]);
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');
    service.getPins.mockClear();

    await store.applyPinned('c1', '1');

    expect(service.getPins).not.toHaveBeenCalled();
  });

  it('applyUnpinned() drops the pin locally', async () => {
    service.getPins.mockResolvedValue([pin('1')]);
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    store.applyUnpinned('c1', '1');

    expect(store.pinnedIds().has('1')).toBe(false);
  });

  it('applyMessageDeleted() removes a deleted pinned message', async () => {
    service.getPins.mockResolvedValue([pin('1')]);
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    store.applyMessageDeleted('1');

    expect(store.pinnedIds().has('1')).toBe(false);
  });

  it('ignores events for a non-active channel', async () => {
    service.getPins.mockResolvedValue([pin('1')]);
    const store = TestBed.inject(PinStore);
    await store.load('g1', 'c1');

    store.applyUnpinned('other-channel', '1');

    expect(store.pinnedIds().has('1')).toBe(true);
  });
});
