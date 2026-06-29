import { TestBed } from '@angular/core/testing';
import { GuildStore } from './guild.store';
import { GuildService } from '../services/guild.service';
import { GuildSummary } from '../models/guild.models';

const makeGuild = (id: string, name: string): GuildSummary => ({
  id,
  name,
  description: null,
  iconKey: null,
  bannerKey: null,
  memberCount: 1,
  isPublic: false,
  ownerId: '1',
  welcomeChannelId: null,
  welcomeMessage: null,
  systemMessagesEnabled: true,
});

describe('GuildStore', () => {
  let store: InstanceType<typeof GuildStore>;
  let service: { getMyGuilds: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { getMyGuilds: vi.fn() };
    TestBed.configureTestingModule({
      providers: [GuildStore, { provide: GuildService, useValue: service }],
    });
    store = TestBed.inject(GuildStore);
  });

  it('starts with empty guilds and no selection', () => {
    expect(store.guilds()).toEqual([]);
    expect(store.selectedGuildId()).toBeNull();
    expect(store.selectedGuild()).toBeNull();
  });

  it('loadGuilds() populates guilds from the service', async () => {
    const guilds = [makeGuild('1', 'Alpha'), makeGuild('2', 'Beta')];
    service.getMyGuilds.mockResolvedValue(guilds);

    await TestBed.runInInjectionContext(() => store.loadGuilds());

    expect(store.guilds()).toHaveLength(2);
    expect(store.guilds()[0].name).toBe('Alpha');
    expect(store.loading()).toBe(false);
  });

  it('loadGuilds() clears loading on error', async () => {
    service.getMyGuilds.mockRejectedValue(new Error('network'));

    await TestBed.runInInjectionContext(() => store.loadGuilds());

    expect(store.guilds()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('selectGuild() updates selectedGuildId and selectedGuild computed', async () => {
    service.getMyGuilds.mockResolvedValue([makeGuild('42', 'My Guild')]);
    await TestBed.runInInjectionContext(() => store.loadGuilds());

    store.selectGuild('42');

    expect(store.selectedGuildId()).toBe('42');
    expect(store.selectedGuild()?.name).toBe('My Guild');
  });

  it('addGuild() appends a guild without a network call', () => {
    store.addGuild(makeGuild('99', 'New'));
    expect(store.guilds()).toHaveLength(1);
    expect(store.guilds()[0].id).toBe('99');
  });
});
