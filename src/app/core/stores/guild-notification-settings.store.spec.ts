import { TestBed } from '@angular/core/testing';
import { GuildNotificationSettingsStore } from './guild-notification-settings.store';
import { GuildNotificationSettingsService } from '../services/guild-notification-settings.service';
import { GuildNotificationSettings } from '../models/notification-setting.models';

const settings = (over: Partial<GuildNotificationSettings> = {}): GuildNotificationSettings => ({
  guildLevel: 'mentions',
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
  };

  beforeEach(() => {
    service = {
      get: vi.fn().mockResolvedValue(settings()),
      setGuildLevel: vi.fn().mockResolvedValue(undefined),
      setChannelLevel: vi.fn().mockResolvedValue(undefined),
      resetChannelLevel: vi.fn().mockResolvedValue(undefined),
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
    expect(store.settingsOf('g1')?.channels).toEqual([{ channelId: 'c1', level: 'nothing' }]);
    expect(service.setChannelLevel).toHaveBeenCalledWith('g1', 'c1', 'nothing');

    await TestBed.runInInjectionContext(() => store.setChannelLevel('g1', 'c1', null));
    expect(store.settingsOf('g1')?.channels).toEqual([]);
    expect(service.resetChannelLevel).toHaveBeenCalledWith('g1', 'c1');
  });

  it('setGuildLevel() reverts from the server on failure', async () => {
    await TestBed.runInInjectionContext(() => store.load('g1')); // cached as 'mentions'
    service.setGuildLevel.mockRejectedValue(new Error('boom'));
    service.get.mockResolvedValue(settings({ guildLevel: 'mentions' }));

    await TestBed.runInInjectionContext(() => store.setGuildLevel('g1', 'nothing'));

    expect(store.settingsOf('g1')?.guildLevel).toBe('mentions');
  });
});
