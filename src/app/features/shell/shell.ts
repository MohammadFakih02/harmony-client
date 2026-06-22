import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith, Subscription } from 'rxjs';
import { SignalRService } from '../../core/services/signalr.service';
import { IdleService } from '../../core/services/idle.service';
import { GuildStore } from '../../core/stores/guild.store';
import { ChannelStore } from '../../core/stores/channel.store';
import { MessageStore } from '../../core/stores/message.store';
import { UnreadStore } from '../../core/stores/unread.store';
import { PresenceStore } from '../../core/stores/presence.store';
import { FriendStore } from '../../core/stores/friend.store';
import { DmStore } from '../../core/stores/dm.store';
import { NotificationStore } from '../../core/stores/notification.store';
import { GuildSidebar } from './guild-sidebar/guild-sidebar';
import { ChannelSidebar } from './channel-sidebar/channel-sidebar';
import { MemberSidebar } from './member-sidebar/member-sidebar';
import { NotificationBell } from './notification-bell/notification-bell';
import { UiIconButton, Lightbox } from '../../shared/ui';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    GuildSidebar,
    ChannelSidebar,
    MemberSidebar,
    NotificationBell,
    UiIconButton,
    Lightbox,
  ],
  templateUrl: './shell.html',
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly signalR = inject(SignalRService);
  protected readonly showMembers = signal(true);
  private readonly router = inject(Router);

  // The member list only applies inside a guild — not on Friends / DM screens.
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly inGuild = computed(() => this.url().includes('/guilds/'));
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly idle = inject(IdleService);

  private readonly subs = new Subscription();

  async ngOnInit(): Promise<void> {
    // Load guilds and connect in parallel; guild data must be ready before joining groups
    const [client] = await Promise.all([
      this.signalR.connect().catch(() => null),
      this.guildStore.loadGuilds(),
    ]);
    this.unreadStore.loadAll();
    this.presenceStore.initMyStatus();
    this.friendStore.load();
    this.dmStore.load();
    this.notificationStore.load();

    if (!client) return;

    // Wire all server → store events
    this.subs.add(client.messageReceived$.subscribe((msg) => {
      this.messageStore.appendMessage(msg);
      // A message arriving in the channel you're currently viewing is already "read" —
      // mark it so the server count resets and no badge appears on the active channel.
      if (msg.channelId === this.messageStore.activeChannelId()) {
        this.unreadStore.markRead(msg.guildId, msg.channelId, msg.messageId).catch(() => {});
      }
      // A DM message can resurface a conversation the recipient had hidden.
      if (msg.guildId == null) this.dmStore.ensureVisible(msg.channelId);
    }));
    this.subs.add(client.messageEdited$.subscribe(({ messageId, content, editedAt }) =>
      this.messageStore.editMessage(messageId, content, editedAt)));
    this.subs.add(client.messageDeleted$.subscribe((id) => this.messageStore.deleteMessage(id)));
    this.subs.add(client.messageFailed$.subscribe((p) => this.messageStore.handleFailed(p)));
    this.subs.add(client.unreadCountUpdated$.subscribe((p) => {
      // Ignore increments for the channel you're viewing — you're reading it, not accruing unreads.
      if (p.channelId === this.messageStore.activeChannelId()) return;
      this.unreadStore.setCount(p);
      // A DM unread is the reliable cross-cutting signal that a conversation exists for us
      // (we may not be joined to its channel group). Surface it in our DM list if it's new.
      if (p.guildId == null) this.dmStore.ensureVisible(p.channelId);
    }));
    this.subs.add(client.channelCreated$.subscribe((ch) => this.channelStore.addChannel(ch)));
    this.subs.add(client.channelUpdated$.subscribe((ch) => this.channelStore.updateChannel(ch)));
    this.subs.add(client.channelDeleted$.subscribe((id) => this.channelStore.removeChannel(id)));

    // Presence events → store. Friends don't exist yet, so today these mainly carry the
    // user's own multi-tab status sync (StatusChanged to self) and member-list dots.
    this.subs.add(client.onlineStatus$.subscribe((p) => this.presenceStore.applyOnline(p)));
    this.subs.add(client.offlineStatus$.subscribe((p) => this.presenceStore.applyOffline(p)));
    this.subs.add(client.statusChanged$.subscribe((p) => this.presenceStore.applyStatusChanged(p)));

    // Friend events → store (incoming requests, accepts, removals/blocks).
    this.subs.add(client.friendRequest$.subscribe((p) => this.friendStore.applyFriendRequest(p)));
    this.subs.add(client.friendAccepted$.subscribe((p) => this.friendStore.applyFriendAccepted(p)));
    this.subs.add(client.friendRemoved$.subscribe((p) => this.friendStore.applyFriendRemoved(p)));

    // Live notification pushes (mentions, friend requests) → store.
    this.subs.add(client.notificationReceived$.subscribe((p) =>
      this.notificationStore.applyNotificationReceived(p)));

    client.onReconnected(() => this.rejoinGroups());

    // Start reporting inactivity (auto-away) now that we have a live connection.
    this.idle.start(client);

    // Join all guilds immediately so channel CRUD events arrive for all servers
    await this.joinAllGuilds(client);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.idle.stop();
    this.signalR.disconnect();
  }

  private async joinAllGuilds(client = this.signalR.client): Promise<void> {
    if (!client) return;
    for (const guild of this.guildStore.guilds()) {
      await client.joinGuild(guild.id).catch(() => {});
    }
  }

  private async rejoinGroups(): Promise<void> {
    const client = this.signalR.client;
    if (!client) return;

    // Rejoin all guilds (not just the selected one) to keep receiving channel CRUD events
    await this.joinAllGuilds(client);

    // Rejoin the channel the user currently has open
    const channelId = this.channelStore.selectedChannelId();
    if (channelId) await client.joinChannel(channelId).catch(() => {});
  }
}
