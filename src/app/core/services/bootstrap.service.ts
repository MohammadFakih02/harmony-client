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

/**
 * Wire shape of GET /api/users/me/bootstrap. Each field mirrors the corresponding standalone
 * endpoint's response exactly, so distribution hands the stores the same JSON they'd have
 * fetched themselves. The profile expiry timestamps are `long?` server-side → strings on the
 * wire (LongStringConverter), coerced below like presence.getMyProfile does.
 */
interface BootstrapResponse {
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
 * stores that used to each fetch their own slice (9 requests → 1). Returns whether it succeeded
 * — the shell falls back to the individual per-store loads when it didn't.
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

  async load(): Promise<boolean> {
    let payload: BootstrapResponse;
    try {
      payload = await firstValueFrom(
        this.http.get<BootstrapResponse>(`${this.base}/users/me/bootstrap`),
      );
    } catch {
      return false; // the shell falls back to the individual loads
    }

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
    return true;
  }
}
