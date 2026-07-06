import { TestBed } from '@angular/core/testing';
import { ChannelStore } from './channel.store';
import { GuildStore } from './guild.store';
import { ChannelService } from '../services/channel.service';
import { Channel } from '../models/channel.models';
import { GatewayEvents } from '../hub/gateway-events';

const makeChannel = (overrides: Partial<Channel> & { id: string; name: string }): Channel => ({
  guildId: '1',
  topic: null,
  type: 'text',
  position: 0,
  categoryId: null,
  isNsfw: false,
  slowmodeSeconds: 0,
  ...overrides,
});

describe('ChannelStore', () => {
  let store: InstanceType<typeof ChannelStore>;
  let guildStore: InstanceType<typeof GuildStore>;
  let service: {
    getGuildChannels: ReturnType<typeof vi.fn>;
    getCapabilities: ReturnType<typeof vi.fn>;
    reorder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getGuildChannels: vi.fn(),
      getCapabilities: vi.fn(),
      reorder: vi.fn().mockResolvedValue([]),
    };
    TestBed.configureTestingModule({
      providers: [
        ChannelStore,
        GuildStore,
        { provide: ChannelService, useValue: service },
        // GuildService is a transitive dep; stub it out
        { provide: 'GuildService', useValue: { getMyGuilds: vi.fn().mockResolvedValue([]) } },
      ],
    });
    store = TestBed.inject(ChannelStore);
    guildStore = TestBed.inject(GuildStore);
  });

  it('starts with no channels and no selection', () => {
    expect(store.currentCategories()).toEqual([]);
    expect(store.selectedChannelId()).toBeNull();
  });

  it('loadCapabilities() applies a cached value instantly on re-open, then the fetch refreshes it', async () => {
    const caps = {
      canView: true, canSend: true, canAttach: true, canManageMessages: false,
      canManageChannels: false, canPin: false, timedOut: false,
    };
    service.getCapabilities.mockResolvedValue(caps);
    store.selectChannel('c1');
    await TestBed.runInInjectionContext(() => store.loadCapabilities('1', 'c1'));
    expect(store.currentCapabilities()).toEqual(caps);

    // Re-open: the cached value is applied synchronously (no null flash → no composer
    // flicker) while the fresh fetch is still in flight.
    let resolveFetch!: (v: unknown) => void;
    service.getCapabilities.mockImplementationOnce(() => new Promise((res) => (resolveFetch = res)));
    const load = TestBed.runInInjectionContext(() => store.loadCapabilities('1', 'c1'));
    expect(store.currentCapabilities()).toEqual(caps);

    const fresh = { ...caps, canSend: false };
    resolveFetch(fresh);
    await load;
    expect(store.currentCapabilities()).toEqual(fresh);
  });

  it('reorderChannels() re-sorts optimistically and persists 0..n positions', async () => {
    service.getGuildChannels.mockResolvedValue([
      makeChannel({ id: '10', name: 'general', guildId: '1', position: 0 }),
      makeChannel({ id: '11', name: 'random', guildId: '1', position: 1 }),
      makeChannel({ id: '12', name: 'dev', guildId: '1', position: 2 }),
    ]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));

    await TestBed.runInInjectionContext(() => store.reorderChannels('1', ['12', '10', '11']));

    expect(store.channelsByGuild()['1'].map((c) => c.id)).toEqual(['12', '10', '11']);
    expect(service.reorder).toHaveBeenCalledWith('1', [
      { channelId: '12', position: 0 },
      { channelId: '10', position: 1 },
      { channelId: '11', position: 2 },
    ]);
  });

  it('reorderChannels() reverts the move when persisting fails', async () => {
    service.getGuildChannels.mockResolvedValue([
      makeChannel({ id: '10', name: 'general', guildId: '1', position: 0 }),
      makeChannel({ id: '11', name: 'random', guildId: '1', position: 1 }),
    ]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));
    service.reorder.mockRejectedValue(new Error('403'));

    await TestBed.runInInjectionContext(() => store.reorderChannels('1', ['11', '10']));

    expect(store.channelsByGuild()['1'].map((c) => c.id)).toEqual(['10', '11']);
  });

  it('loadChannels() stores channels keyed by guildId', async () => {
    const channels = [
      makeChannel({ id: '10', name: 'general', guildId: '1' }),
      makeChannel({ id: '11', name: 'off-topic', guildId: '1' }),
    ];
    service.getGuildChannels.mockResolvedValue(channels);

    await TestBed.runInInjectionContext(() => store.loadChannels('1'));

    expect(store.channelsByGuild()['1']).toHaveLength(2);
  });

  it('currentCategories groups channels under their category container', async () => {
    // Category container channel (other channels reference it via categoryId)
    const textCategory = makeChannel({ id: '1', name: 'text channels', guildId: '1', type: 'category', categoryId: null, position: 0 });
    const general = makeChannel({ id: '2', name: 'general', guildId: '1', type: 'text', categoryId: '1', position: 1 });
    const announce = makeChannel({ id: '3', name: 'announcements', guildId: '1', type: 'announcement', categoryId: '1', position: 2 });

    service.getGuildChannels.mockResolvedValue([textCategory, general, announce]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));
    guildStore.selectGuild('1');

    const cats = store.currentCategories();
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe('TEXT CHANNELS');
    expect(cats[0].channels).toHaveLength(2);
  });

  it('currentCategories puts uncategorized channels in a nameless group', async () => {
    const ch = makeChannel({ id: '5', name: 'lobby', guildId: '1', categoryId: null });
    service.getGuildChannels.mockResolvedValue([ch]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));
    guildStore.selectGuild('1');

    const cats = store.currentCategories();
    expect(cats[0].id).toBeNull();
    expect(cats[0].name).toBe('');
    expect(cats[0].channels[0].id).toBe('5');
  });

  it('toggleCategory() flips collapsed state', async () => {
    const cat = makeChannel({ id: '1', name: 'cat', guildId: '1', type: 'category', categoryId: null, position: 0 });
    const ch = makeChannel({ id: '2', name: 'ch', guildId: '1', categoryId: '1' });
    service.getGuildChannels.mockResolvedValue([cat, ch]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));
    guildStore.selectGuild('1');

    expect(store.currentCategories()[0].collapsed).toBe(false);
    store.toggleCategory('1');
    expect(store.currentCategories()[0].collapsed).toBe(true);
    store.toggleCategory('1');
    expect(store.currentCategories()[0].collapsed).toBe(false);
  });

  it('removeChannel() strips the channel from all guilds', async () => {
    service.getGuildChannels.mockResolvedValue([
      makeChannel({ id: '10', name: 'a', guildId: '1' }),
      makeChannel({ id: '11', name: 'b', guildId: '1' }),
    ]);
    await TestBed.runInInjectionContext(() => store.loadChannels('1'));

    store.removeChannel('10');

    expect(store.channelsByGuild()['1']?.map((c) => c.id)).toEqual(['11']);
  });

  it('reacts to a ChannelCreated gateway event (self-subscribed in onInit)', () => {
    TestBed.inject(GatewayEvents).emit({
      type: 'ChannelCreated',
      channel: makeChannel({ id: '99', name: 'new', guildId: '1' }),
    });

    expect(store.channelsByGuild()['1']?.map((c) => c.id)).toEqual(['99']);
  });

  it('addChannel() is idempotent (creator optimistic add + ChannelCreated broadcast → no dupe)', () => {
    const ch = makeChannel({ id: '99', name: 'new', guildId: '1' });
    store.addChannel(ch);
    store.addChannel(ch); // e.g. the broadcast echo of our own create
    expect(store.channelsByGuild()['1']?.map((c) => c.id)).toEqual(['99']);
  });
});
