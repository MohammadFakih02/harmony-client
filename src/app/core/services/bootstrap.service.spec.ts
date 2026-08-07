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
import { AuthService } from './auth.service';
import { BootstrapCacheDb } from './bootstrap-cache.db';

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
  let auth: { currentUser: ReturnType<typeof vi.fn> };
  let cache: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };

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
    dms: [
      { channelId: '20', isGroup: false, name: null, iconKey: null, lastReadId: '0', participants: [] },
    ],
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
    // Default: no signed-in user id → the cache path is skipped, so these two mirror the pre-cache
    // behaviour exactly. The cache-path tests override currentUser + read.
    auth = { currentUser: vi.fn(() => null) };
    cache = { read: vi.fn().mockResolvedValue(null), write: vi.fn(), clear: vi.fn() };

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
        { provide: AuthService, useValue: auth },
        { provide: BootstrapCacheDb, useValue: cache },
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

  const cachedPayload = { ...payload, guilds: [{ id: '99', name: 'Cached Guild' }] };

  it('paints the cached shell first, then reconciles with the fetched payload', async () => {
    auth.currentUser.mockReturnValue({ id: 'u1' });
    cache.read.mockResolvedValue(cachedPayload);

    const load = service.load();
    http.expectOne(`${environment.apiUrl}/users/me/bootstrap`).flush(payload);

    await expect(load).resolves.toBe(true);
    expect(cache.read).toHaveBeenCalledWith('u1');
    // Distributed twice — cached snapshot first (instant paint), fresh payload second (reconcile).
    expect(guildStore.setGuilds).toHaveBeenNthCalledWith(1, cachedPayload.guilds);
    expect(guildStore.setGuilds).toHaveBeenNthCalledWith(2, payload.guilds);
    // The fresh payload is persisted for the next boot; the cache read never triggers a write.
    expect(cache.write).toHaveBeenCalledExactlyOnceWith('u1', payload);
  });

  it('keeps the cached shell (returns true) and does not persist when the fetch fails', async () => {
    auth.currentUser.mockReturnValue({ id: 'u1' });
    cache.read.mockResolvedValue(cachedPayload);

    const load = service.load();
    http.expectOne(`${environment.apiUrl}/users/me/bootstrap`).error(new ProgressEvent('error'));

    await expect(load).resolves.toBe(true);
    expect(guildStore.setGuilds).toHaveBeenCalledExactlyOnceWith(cachedPayload.guilds);
    expect(cache.write).not.toHaveBeenCalled();
  });

  it('skips the cache and behaves as before when there is no cached snapshot', async () => {
    auth.currentUser.mockReturnValue({ id: 'u1' });
    cache.read.mockResolvedValue(null);

    const load = service.load();
    http.expectOne(`${environment.apiUrl}/users/me/bootstrap`).flush(payload);

    await expect(load).resolves.toBe(true);
    expect(guildStore.setGuilds).toHaveBeenCalledExactlyOnceWith(payload.guilds);
    expect(cache.write).toHaveBeenCalledExactlyOnceWith('u1', payload);
  });
});
