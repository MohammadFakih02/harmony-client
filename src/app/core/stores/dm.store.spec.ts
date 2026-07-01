import { TestBed } from '@angular/core/testing';
import { DmStore } from './dm.store';
import { DirectMessageService } from '../services/direct-message.service';
import { DirectMessageChannel } from '../models/direct-message.models';

const group: DirectMessageChannel = {
  channelId: 'g1',
  isGroup: true,
  name: 'Squad',
  lastReadId: '0',
  participants: [
    { userId: 'u1', username: 'alice', avatarKey: null },
    { userId: 'u2', username: 'bob', avatarKey: null },
  ],
};

describe('DmStore (group DMs)', () => {
  let service: {
    getMyDms: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
    addParticipant: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getMyDms: vi.fn().mockResolvedValue([]),
      createGroup: vi.fn().mockResolvedValue(group),
      addParticipant: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      hide: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [DmStore, { provide: DirectMessageService, useValue: service }],
    });
  });

  it('createGroup() adds the new group to the list and returns it', async () => {
    const store = TestBed.inject(DmStore);

    const created = await store.createGroup('Squad', ['u1', 'u2']);

    expect(service.createGroup).toHaveBeenCalledWith('Squad', ['u1', 'u2']);
    expect(created.channelId).toBe('g1');
    expect(store.find('g1')?.isGroup).toBe(true);
  });

  it('addParticipant() calls the service then refetches the list', async () => {
    service.getMyDms.mockResolvedValue([group]);
    const store = TestBed.inject(DmStore);

    await store.addParticipant('g1', 'u3');

    expect(service.addParticipant).toHaveBeenCalledWith('g1', 'u3');
    expect(service.getMyDms).toHaveBeenCalled();
    expect(store.find('g1')).toBeDefined();
  });

  it('leave() optimistically drops the group from the list', async () => {
    await TestBed.inject(DmStore).createGroup('Squad', ['u1', 'u2']);
    const store = TestBed.inject(DmStore);
    expect(store.find('g1')).toBeDefined();

    await store.leave('g1');

    expect(service.leave).toHaveBeenCalledWith('g1');
    expect(store.find('g1')).toBeUndefined();
  });

  it('find() returns undefined for an unknown channel', () => {
    expect(TestBed.inject(DmStore).find('nope')).toBeUndefined();
  });
});
