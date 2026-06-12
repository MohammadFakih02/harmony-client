import { TestBed } from '@angular/core/testing';
import { UnreadStore } from './unread.store';
import { MessageService } from '../services/message.service';

describe('UnreadStore', () => {
  let store: InstanceType<typeof UnreadStore>;
  let service: {
    getUnreadCounts: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getUnreadCounts: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [UnreadStore, { provide: MessageService, useValue: service }],
    });
    store = TestBed.inject(UnreadStore);
  });

  it('starts with empty counts', () => {
    expect(store.counts()).toEqual({});
  });

  it('loadAll() populates counts from the service (skips zero counts)', async () => {
    service.getUnreadCounts.mockResolvedValue([
      { channelId: 1, unreadCount: 5 },
      { channelId: 2, unreadCount: 0 },
      { channelId: 3, unreadCount: 2 },
    ]);

    await TestBed.runInInjectionContext(() => store.loadAll());

    expect(store.counts()[1]).toBe(5);
    expect(store.counts()[2]).toBeUndefined();
    expect(store.counts()[3]).toBe(2);
  });

  it('setCount() updates the count for a specific channel', () => {
    store.setCount({ channelId: 7, guildId: 1, unreadCount: 10 });
    expect(store.counts()[7]).toBe(10);

    store.setCount({ channelId: 7, guildId: 1, unreadCount: 11 });
    expect(store.counts()[7]).toBe(11);
  });

  it('markRead() zeroes the local count immediately and calls the backend', async () => {
    store.setCount({ channelId: 4, guildId: 1, unreadCount: 8 });

    await TestBed.runInInjectionContext(() => store.markRead(1, 4, 999));

    expect(store.counts()[4]).toBe(0);
    expect(service.markRead).toHaveBeenCalledWith(1, 4, 999);
  });

  it('markRead() fails open — local count stays 0 even if backend call throws', async () => {
    service.markRead.mockRejectedValue(new Error('offline'));
    store.setCount({ channelId: 5, guildId: 1, unreadCount: 3 });

    await TestBed.runInInjectionContext(() => store.markRead(1, 5, 1));

    expect(store.counts()[5]).toBe(0);
  });
});
