import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildSummary } from '../models/guild.models';
import { UnreadCountResponse } from '../models/message.models';
import { Friend, PendingFriend } from '../models/friend.models';
import { DirectMessageChannel } from '../models/direct-message.models';
import { AppNotification } from '../models/notification.models';
import { GuildStore } from '../stores/guild.store';
import { UnreadStore } from '../stores/unread.store';
import { PresenceStore } from '../stores/presence.store';
import { FriendStore } from '../stores/friend.store';
import { DmStore } from '../stores/dm.store';
import { NicknameStore } from '../stores/nickname.store';
import { NotificationStore } from '../stores/notification.store';
import { AuthService } from './auth.service';
import { BootstrapCacheDb } from './bootstrap-cache.db';

/**
 * Wire shape of GET /api/users/me/bootstrap. Each field mirrors the corresponding standalone
 * endpoint's response exactly, so distribution hands the stores the same JSON they'd have
 * fetched themselves. The profile expiry timestamps are `long?` server-side → strings on the
 * wire (LongStringConverter), coerced below like presence.getMyProfile does.
 */
export interface BootstrapResponse {
  profile: {
    preferredStatus: string;
    statusMessage: string | null;
    preferredStatusExpiresAt: string | null;
    statusMessageExpiresAt: string | null;
  };
  guilds: GuildSummary[];
  unread: UnreadCountResponse[];
  friends: Friend[];
  pendingFriends: PendingFriend[];
  dms: DirectMessageChannel[];
  nicknames: Record<string, string>;
  notifications: AppNotification[];
  notificationUnreadCount: number;
}

/**
 * One-round-trip startup load: fetches the aggregated boot payload and distributes it into the
 * stores that used to each fetch their own slice (9 requests → 1). Returns whether the shell is
 * populated — the shell falls back to the individual per-store loads only when it isn't.
 *
 * Local-first (Track A1 slice 2): the last successful payload is persisted to IndexedDB and painted
 * back instantly on the next boot, so the shell renders from cache while the network request is in
 * flight, then reconciles when it lands. The in-memory signal stores stay the source of truth.
 */
@Injectable({ providedIn: 'root' })
export class BootstrapService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  private readonly guildStore = inject(GuildStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly auth = inject(AuthService);
  private readonly cache = inject(BootstrapCacheDb);

  async load(): Promise<boolean> {
    const userId = this.auth.currentUser()?.id;

    // Start the network request FIRST so the cache read below can never delay it.
    const fetchPromise = firstValueFrom(
      this.http.get<BootstrapResponse>(`${this.base}/users/me/bootstrap`),
    );

    // Paint the shell from the last cached payload (this same user's) while the request is in flight.
    // Skipped when there's no user id yet or no cache → identical to the pre-cache path.
    let paintedFromCache = false;
    if (userId) {
      const cached = await this.cache.read(userId).catch(() => null);
      if (cached) {
        this.distribute(cached);
        paintedFromCache = true;
      }
    }

    let payload: BootstrapResponse;
    try {
      payload = await fetchPromise;
    } catch {
      // Network/bootstrap failed. If a cached shell is already painted, treat boot as done (live
      // gateway events + the next successful boot reconcile) instead of firing the individual
      // fallback loads, which would fail too when offline. With no cache, fall back as before.
      return paintedFromCache;
    }

    this.distribute(payload);
    if (userId) void this.cache.write(userId, payload);
    return true;
  }

  /** Fan the boot payload out into every store that used to fetch its own slice. Idempotent. */
  private distribute(payload: BootstrapResponse): void {
    this.guildStore.setGuilds(payload.guilds);
    this.unreadStore.applyAll(payload.unread);
    this.presenceStore.applyMyProfile({
      preferredStatus: payload.profile.preferredStatus,
      statusMessage: payload.profile.statusMessage,
      preferredStatusExpiresAt:
        payload.profile.preferredStatusExpiresAt != null
          ? Number(payload.profile.preferredStatusExpiresAt)
          : null,
      statusMessageExpiresAt:
        payload.profile.statusMessageExpiresAt != null
          ? Number(payload.profile.statusMessageExpiresAt)
          : null,
    });
    this.friendStore.set(payload.friends, payload.pendingFriends);
    this.dmStore.set(payload.dms);
    this.nicknameStore.setAll(payload.nicknames);
    this.notificationStore.set(payload.notifications, payload.notificationUnreadCount);
  }
}
