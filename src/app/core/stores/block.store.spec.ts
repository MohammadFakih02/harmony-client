import { TestBed } from '@angular/core/testing';
import { BlockStore } from './block.store';
import { BlockService } from '../services/block.service';
import { BlockedUser } from '../models/block.models';

const blocked: BlockedUser[] = [
  { id: '111', username: 'spammer', avatarKey: null, bannerKey: null, createdAt: 1 },
  { id: '222', username: 'troll', avatarKey: null, bannerKey: null, createdAt: 2 },
];

describe('BlockStore', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    block: ReturnType<typeof vi.fn>;
    unblock: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue([...blocked]),
      block: vi.fn().mockResolvedValue(undefined),
      unblock: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [BlockStore, { provide: BlockService, useValue: service }],
    });
  });

  it('load() fills the blocked list', async () => {
    const store = TestBed.inject(BlockStore);
    await store.load();
    expect(store.blocked()).toHaveLength(2);
  });

  it('unblock() optimistically removes the user', async () => {
    const store = TestBed.inject(BlockStore);
    await store.load();

    await store.unblock('111');

    expect(service.unblock).toHaveBeenCalledWith('111');
    expect(store.blocked().some((u) => u.id === '111')).toBe(false);
  });

  it('unblock() restores on failure', async () => {
    service.unblock.mockRejectedValue(new Error('boom'));
    const store = TestBed.inject(BlockStore);
    await store.load();

    await store.unblock('111');

    expect(store.blocked().some((u) => u.id === '111')).toBe(true);
  });

  it('block() optimistically adds the user and exposes the id via blockedIds', async () => {
    const store = TestBed.inject(BlockStore);

    await store.block({ id: '333', username: 'newguy' });

    expect(service.block).toHaveBeenCalledWith('333');
    expect(store.blockedIds().has('333')).toBe(true);
    expect(store.isBlocked('333')).toBe(true);
  });

  it('block() reverts and rethrows on failure', async () => {
    service.block.mockRejectedValue(new Error('boom'));
    const store = TestBed.inject(BlockStore);

    await expect(store.block({ id: '333', username: 'newguy' })).rejects.toThrow();
    expect(store.isBlocked('333')).toBe(false);
  });

  it('block() is a no-op for an already-blocked user', async () => {
    const store = TestBed.inject(BlockStore);
    await store.load();

    await store.block({ id: '111', username: 'spammer' });

    expect(service.block).not.toHaveBeenCalled();
    expect(store.blocked()).toHaveLength(2);
  });
});
