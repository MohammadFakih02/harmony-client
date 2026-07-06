import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { BootstrapService } from './bootstrap.service';
import { GuildStore } from '../stores/guild.store';
import { UnreadStore } from '../stores/unread.store';
import { PresenceStore } from '../stores/presence.store';
import { FriendStore } from '../stores/friend.store';
import { DmStore } from '../stores/dm.store';
import { NicknameStore } from '../stores/nickname.store';
import { NotificationStore } from '../stores/notification.store';

describe('BootstrapService', () => {
  let service: BootstrapService;
  let http: HttpTestingController;
  let guildStore: { setGuilds: ReturnType<typeof vi.fn> };
  let unreadStore: { applyAll: ReturnType<typeof vi.fn> };
  let presenceStore: { applyMyProfile: ReturnType<typeof vi.fn> };
  let friendStore: { set: ReturnType<typeof vi.fn> };
  let dmStore: { set: ReturnType<typeof vi.fn> };
  let nicknameStore: { setAll: ReturnType<typeof vi.fn> };
  let notificationStore: { set: ReturnType<typeof vi.fn> };

  // Wire-shape payload: ids/timestamps arrive as strings (LongStringConverter), exactly as the
  // standalone endpoints deliver them — distribution must pass them through untouched, except
  // the profile expiries, which are coerced to numbers.
  const payload = {
    profile: {
      preferredStatus: 'dnd',
      statusMessage: 'busy',
      preferredStatusExpiresAt: '1750000000000',
      statusMessageExpiresAt: null,
    },
    guilds: [{ id: '1', name: 'Guild' }],
    unread: [{ channelId: '10', guildId: '1', unreadCount: 3 }],
    friends: [{ id: '2', username: 'bob' }],
    pendingFriends: [{ id: '3', username: 'carol', direction: 'incoming' }],
    dms: [{ channelId: '20', isGroup: false, name: null, lastReadId: '0', participants: [] }],
    nicknames: { '2': 'Bee' },
    notifications: [{ id: '30', type: 'mention', isRead: false }],
    notificationUnreadCount: 1,
  };

  beforeEach(() => {
    guildStore = { setGuilds: vi.fn() };
    unreadStore = { applyAll: vi.fn() };
    presenceStore = { applyMyProfile: vi.fn() };
    friendStore = { set: vi.fn() };
    dmStore = { set: vi.fn() };
    nicknameStore = { setAll: vi.fn() };
    notificationStore = { set: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GuildStore, useValue: guildStore },
        { provide: UnreadStore, useValue: unreadStore },
        { provide: PresenceStore, useValue: presenceStore },
        { provide: FriendStore, useValue: friendStore },
        { provide: DmStore, useValue: dmStore },
        { provide: NicknameStore, useValue: nicknameStore },
        { provide: NotificationStore, useValue: notificationStore },
      ],
    });
    service = TestBed.inject(BootstrapService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('fetches once and distributes every slice into its store', async () => {
    const load = service.load();
    http.expectOne(`${environment.apiUrl}/users/me/bootstrap`).flush(payload);

    await expect(load).resolves.toBe(true);
    expect(guildStore.setGuilds).toHaveBeenCalledWith(payload.guilds);
    expect(unreadStore.applyAll).toHaveBeenCalledWith(payload.unread);
    expect(presenceStore.applyMyProfile).toHaveBeenCalledWith({
      preferredStatus: 'dnd',
      statusMessage: 'busy',
      preferredStatusExpiresAt: 1750000000000, // string on the wire → number
      statusMessageExpiresAt: null,
    });
    expect(friendStore.set).toHaveBeenCalledWith(payload.friends, payload.pendingFriends);
    expect(dmStore.set).toHaveBeenCalledWith(payload.dms);
    expect(nicknameStore.setAll).toHaveBeenCalledWith(payload.nicknames);
    expect(notificationStore.set).toHaveBeenCalledWith(payload.notifications, 1);
  });

  it('returns false on failure without touching any store (the shell falls back)', async () => {
    const load = service.load();
    http.expectOne(`${environment.apiUrl}/users/me/bootstrap`).error(new ProgressEvent('error'));

    await expect(load).resolves.toBe(false);
    expect(guildStore.setGuilds).not.toHaveBeenCalled();
    expect(notificationStore.set).not.toHaveBeenCalled();
  });
});
