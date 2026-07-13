import { TestBed } from '@angular/core/testing';
import { GuildNotificationSettingsStore } from './guild-notification-settings.store';
import { GuildNotificationSettingsService } from '../services/guild-notification-settings.service';
import { GuildNotificationSettings } from '../models/notification-setting.models';

const settings = (over: Partial<GuildNotificationSettings> = {}): GuildNotificationSettings => ({
  guildLevel: 'mentions',
  guildSuppressEveryone: false,
  channels: [],
  ...over,
});

describe('GuildNotificationSettingsStore', () => {
  let store: InstanceType<typeof GuildNotificationSettingsStore>;
  let service: {
    get: ReturnType<typeof vi.fn>;
    setGuildLevel: ReturnType<typeof vi.fn>;
    setChannelLevel: ReturnType<typeof vi.fn>;
    resetChannelLevel: ReturnType<typeof vi.fn>;
    setGuildSuppressEveryone: ReturnType<typeof vi.fn>;
    setChannelSuppressEveryone: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      get: vi.fn().mockResolvedValue(settings()),
      setGuildLevel: vi.fn().mockResolvedValue(undefined),
      setChannelLevel: vi.fn().mockResolvedValue(undefined),
      resetChannelLevel: vi.fn().mockResolvedValue(undefined),
      setGuildSuppressEveryone: vi.fn().mockResolvedValue(undefined),
      setChannelSuppressEveryone: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        GuildNotificationSettingsStore,
        { provide: GuildNotificationSettingsService, useValue: service },
      ],
    });
    store = TestBed.inject(GuildNotificationSettingsStore);
  });

  it('load() caches settings per guild', async () => {
    service.get.mockResolvedValue(settings({ guildLevel: 'nothing' }));
    await TestBed.runInInjectionContext(() => store.load('g1'));
    expect(store.settingsOf('g1')?.guildLevel).toBe('nothing');
    expect(store.settingsOf('g2')).toBeNull();
  });

  it('setGuildLevel() optimistically updates and calls the service', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1'));
    await TestBed.runInInjectionContext(() => store.setGuildLevel('g1', 'all'));
    expect(store.settingsOf('g1')?.guildLevel).toBe('all');
    expect(service.setGuildLevel).toHaveBeenCalledWith('g1', 'all');
  });

  it('setChannelLevel(level) adds an override; null clears it', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1'));

    await TestBed.runInInjectionContext(() => store.setChannelLevel('g1', 'c1', 'nothing'));
    expect(store.settingsOf('g1')?.channels).toEqual([
      { channelId: 'c1', level: 'nothing', suppressEveryone: false },
    ]);
    expect(service.setChannelLevel).toHaveBeenCalledWith('g1', 'c1', 'nothing');

    await TestBed.runInInjectionContext(() => store.setChannelLevel('g1', 'c1', null));
    expect(store.settingsOf('g1')?.channels).toEqual([]);
    expect(service.resetChannelLevel).toHaveBeenCalledWith('g1', 'c1');
  });

  it('setGuildSuppressEveryone() optimistically updates and calls the service', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1'));
    await TestBed.runInInjectionContext(() => store.setGuildSuppressEveryone('g1', true));
    expect(store.settingsOf('g1')?.guildSuppressEveryone).toBe(true);
    expect(service.setGuildSuppressEveryone).toHaveBeenCalledWith('g1', true);
  });

  it('setChannelSuppressEveryone() materializes a default-level row carrying the flag', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1'));
    await TestBed.runInInjectionContext(() => store.setChannelSuppressEveryone('g1', 'c1', true));
    expect(store.settingsOf('g1')?.channels).toEqual([
      { channelId: 'c1', level: 'mentions', suppressEveryone: true },
    ]);
    expect(service.setChannelSuppressEveryone).toHaveBeenCalledWith('g1', 'c1', true);
  });

  it('setChannelSuppressEveryone() preserves an existing level override', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1'));
    await TestBed.runInInjectionContext(() => store.setChannelLevel('g1', 'c1', 'nothing'));
    await TestBed.runInInjectionContext(() => store.setChannelSuppressEveryone('g1', 'c1', true));
    expect(store.settingsOf('g1')?.channels).toEqual([
      { channelId: 'c1', level: 'nothing', suppressEveryone: true },
    ]);
  });

  it('setGuildLevel() reverts from the server on failure', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1')); // cached as 'mentions'
    service.setGuildLevel.mockRejectedValue(new Error('boom'));
    service.get.mockResolvedValue(settings({ guildLevel: 'mentions' }));

    await TestBed.runInInjectionContext(() => store.setGuildLevel('g1', 'nothing'));

    expect(store.settingsOf('g1')?.guildLevel).toBe('mentions');
  });
});
