import { TestBed } from '@angular/core/testing';
import { MuteStore } from './mute.store';
import { MuteService } from '../services/mute.service';
import { Mute } from '../models/mute.models';

const mutes: Mute[] = [
  { targetType: 'user', targetId: '111', mutedUntil: null, createdAt: 1 },
  { targetType: 'channel', targetId: '222', mutedUntil: 1700000000000, createdAt: 2 },
];

describe('MuteStore', () => {
  let service: { list: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = {
      list: vi.fn().mockResolvedValue([...mutes]),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [MuteStore, { provide: MuteService, useValue: service }],
    });
  });

  it('load() fills the list', async () => {
    const store = TestBed.inject(MuteStore);
    await store.load();
    expect(store.mutes()).toHaveLength(2);
  });

  it('remove() optimistically drops the matching mute', async () => {
    const store = TestBed.inject(MuteStore);
    await store.load();

    await store.remove('user', '111');

    expect(service.remove).toHaveBeenCalledWith('user', '111');
    expect(store.mutes().some((m) => m.targetId === '111')).toBe(false);
    expect(store.mutes().some((m) => m.targetId === '222')).toBe(true);
  });

  it('remove() restores the mute on failure', async () => {
    service.remove.mockRejectedValue(new Error('boom'));
    const store = TestBed.inject(MuteStore);
    await store.load();

    await store.remove('user', '111');

    expect(store.mutes().some((m) => m.targetId === '111')).toBe(true);
  });
});
