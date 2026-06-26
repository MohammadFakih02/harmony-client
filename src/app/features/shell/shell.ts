import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
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
import { MemberStore } from '../../core/stores/member.store';
import { FriendStore } from '../../core/stores/friend.store';
import { DmStore } from '../../core/stores/dm.store';
import { NotificationStore } from '../../core/stores/notification.store';
import { GuildSidebar } from './guild-sidebar/guild-sidebar';
import { ChannelSidebar } from './channel-sidebar/channel-sidebar';
import { MemberSidebar } from './member-sidebar/member-sidebar';
import { NotificationBell } from './notification-bell/notification-bell';
import { InvitePeopleModal } from '../guilds/invite-people-modal/invite-people-modal';
import { UiAvatar, UiIconButton, Lightbox } from '../../shared/ui';
import { toAvatarStatus } from '../../core/models/presence.models';
import { snowflakeToDate } from '../../shared/util/snowflake';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    GuildSidebar,
    ChannelSidebar,
    MemberSidebar,
    NotificationBell,
    InvitePeopleModal,
    UiAvatar,
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
  protected readonly inDm = computed(() => this.url().includes('/dm/'));
  // Invite People modal (guild header) — keyed to the currently-selected guild.
  protected readonly showInviteModal = signal(false);
  protected readonly activeGuildId = computed(() => this.guildStore.selectedGuildId());
  // Right-hand DM profile panel (mirrors the guild member-list toggle).
  protected readonly showDmProfile = signal(true);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly memberStore = inject(MemberStore);

  // --- Header bar context (guild channel name+topic, or DM peer identity) ---
  protected readonly headerChannel = computed(() => this.channelStore.selectedChannel());
  protected readonly dmPeer = computed(() => {
    const channelId = this.messageStore.activeChannelId();
    return this.inDm() && channelId ? this.dmStore.peerOf(channelId) : undefined;
  });
  protected readonly dmPeerStatus = computed(() => {
    const peer = this.dmPeer();
    return peer ? toAvatarStatus(this.presenceStore.statusOf(peer.peerId)) : null;
  });
  protected readonly dmPeerMessage = computed(() => {
    const peer = this.dmPeer();
    return peer ? this.presenceStore.statusMessageOf(peer.peerId) : null;
  });
  private readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);
  private readonly notificationStore = inject(NotificationStore);
  private readonly idle = inject(IdleService);

  private readonly subs = new Subscription();

  constructor() {
    // Opening a channel counts as "viewing the cause": clear any unread mention
    // notifications for it, mirroring how the unread badge resets on the active channel.
    effect(() => {
      const channelId = this.messageStore.activeChannelId();
      if (channelId) this.notificationStore.markChannelMentionsRead(channelId);
    });
  }

  /** "Member Since" date for the DM profile panel, derived from the peer's snowflake id. */
  protected memberSince(userId: string): string {
    const date = snowflakeToDate(userId);
    return date ? date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

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
    this.subs.add(client.notificationReceived$.subscribe((p) => {
      this.notificationStore.applyNotificationReceived(p);
      // A mention in the channel you're already viewing shouldn't ping — record it read
      // immediately so it lands in history without bumping the badge.
      if (p.type === 'mention' && p.channelId && p.channelId === this.messageStore.activeChannelId()) {
        this.notificationStore.markRead(p.id);
      }
    }));

    // Member moderation events. MemberRemoved/MemberUpdated reach the whole guild group;
    // Kicked reaches only the affected user, so any emission means *we* were removed.
    this.subs.add(client.memberRemoved$.subscribe((p) =>
      this.memberStore.removeMember(p.guildId, p.userId)));
    this.subs.add(client.memberUpdated$.subscribe((p) =>
      this.memberStore.applyMemberUpdated(p.guildId, p.userId, p.communicationDisabledUntil)));
    this.subs.add(client.kicked$.subscribe((p) => this.handleKicked(p.guildId)));

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

  /** We were kicked or banned from a guild: drop it locally, leave its group, and navigate out if open. */
  private async handleKicked(guildId: string): Promise<void> {
    const wasViewing = this.router.url.includes(`/guilds/${guildId}`);
    await this.signalR.client?.leaveGuild(guildId).catch(() => {});
    this.guildStore.removeGuild(guildId);
    if (wasViewing) this.router.navigate(['/friends']);
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
