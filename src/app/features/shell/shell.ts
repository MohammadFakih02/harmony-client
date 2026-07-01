import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith, Subscription } from 'rxjs';
import { SignalRService } from '../../core/services/signalr.service';
import { HarmonyHubClient } from '../../core/hub/harmony-hub.client';
import { IdleService } from '../../core/services/idle.service';
import { GuildStore } from '../../core/stores/guild.store';
import { ChannelStore } from '../../core/stores/channel.store';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { MessageStore } from '../../core/stores/message.store';
import { PinStore } from '../../core/stores/pin.store';
import { PinsPanel } from '../channels/pins-panel/pins-panel';
import { UnreadStore } from '../../core/stores/unread.store';
import { PresenceStore } from '../../core/stores/presence.store';
import { MemberStore } from '../../core/stores/member.store';
import { RoleStore } from '../../core/stores/role.store';
import { FriendStore } from '../../core/stores/friend.store';
import { DmStore } from '../../core/stores/dm.store';
import { NicknameStore } from '../../core/stores/nickname.store';
import { NotificationStore } from '../../core/stores/notification.store';
import { GuildSidebar } from './guild-sidebar/guild-sidebar';
import { ChannelSidebar } from './channel-sidebar/channel-sidebar';
import { MemberSidebar } from './member-sidebar/member-sidebar';
import { NotificationBell } from './notification-bell/notification-bell';
import { ToastContainer } from './toast-container/toast-container';
import { UserProfileModal } from './user-profile-modal/user-profile-modal';
import { InvitePeopleModal } from '../guilds/invite-people-modal/invite-people-modal';
import { RolesModal } from '../guilds/roles-modal/roles-modal';
import { GroupDmModal } from '../channels/group-dm-modal/group-dm-modal';
import { UiAvatar, UiIconButton, Lightbox } from '../../shared/ui';
import { toAvatarStatus } from '../../core/models/presence.models';
import {
  DmParticipant,
  dmLabel,
  dmPeer as oneToOnePeer,
} from '../../core/models/direct-message.models';
import { snowflakeToDate } from '../../shared/util/snowflake';
import { ToastService } from '../../core/services/toast.service';

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
    RolesModal,
    GroupDmModal,
    UiAvatar,
    UiIconButton,
    Lightbox,
    ToastContainer,
    UserProfileModal,
    OverlayModule,
    PinsPanel,
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
  // Roles management modal (guild header) — gated on ManageRoles.
  protected readonly showRolesModal = signal(false);
  // Pinned-messages panel (header, guild + DM) — anchored under the pin button.
  protected readonly showPins = signal(false);
  protected readonly pinsPanelPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];
  protected readonly activeGuildId = computed(() => this.guildStore.selectedGuildId());
  protected readonly canManageRoles = computed(() => {
    const guildId = this.activeGuildId();
    return !!guildId && !!this.memberStore.capabilitiesOf(guildId)?.canManageRoles;
  });
  // Invite People is gated on CreateInvite (every member has it by default, but a role can deny it).
  protected readonly canCreateInvite = computed(() => {
    const guildId = this.activeGuildId();
    return !!guildId && !!this.memberStore.capabilitiesOf(guildId)?.canCreateInvite;
  });
  // Right-hand DM profile panel (mirrors the guild member-list toggle).
  protected readonly showDmProfile = signal(true);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly pinStore = inject(PinStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly toast = inject(ToastService);

  // --- Header bar context (guild channel name+topic, or DM peer/group identity) ---
  protected readonly headerChannel = computed(() => this.channelStore.selectedChannel());
  // The active DM/group channel (undefined outside a DM).
  protected readonly dmChannel = computed(() => {
    const channelId = this.messageStore.activeChannelId();
    return this.inDm() && channelId ? this.dmStore.find(channelId) : undefined;
  });
  protected readonly dmIsGroup = computed(() => this.dmChannel()?.isGroup ?? false);
  // The single peer of a 1:1 DM (undefined for a group — drives status dot + profile panel).
  protected readonly dmPeer = computed(() => oneToOnePeer(this.dmChannel()));
  protected readonly dmPeerStatus = computed(() => {
    const peer = this.dmPeer();
    return peer ? toAvatarStatus(this.presenceStore.statusOf(peer.userId)) : null;
  });
  protected readonly dmPeerMessage = computed(() => {
    const peer = this.dmPeer();
    return peer ? this.presenceStore.statusMessageOf(peer.userId) : null;
  });
  // Header label: the group name (or joined member names) / the 1:1 peer's display name.
  protected readonly dmHeaderName = computed(() => {
    const dm = this.dmChannel();
    return dm ? dmLabel(dm, (p) => this.dmMemberName(p)) : null;
  });
  // Group members for the profile panel (each with nickname precedence applied at render).
  protected readonly dmMembers = computed(() => this.dmChannel()?.participants ?? []);
  private readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
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

    // Ensure guild-level capabilities + roles are loaded for the active guild (the header's Roles
    // button and the role-coloring UI need these even when the member sidebar is closed).
    effect(() => {
      const guildId = this.activeGuildId();
      if (!guildId) return;
      this.memberStore.loadCapabilitiesIfNeeded(guildId);
      this.memberStore.loadIfNeeded(guildId); // also needed for chat author role colours when the sidebar is closed
      this.roleStore.loadIfNeeded(guildId);
    });

    // Reconcile the active workspace whenever the socket RECOVERS from a drop (reconnecting/
    // disconnected → connected) — real-time events sent during the gap would otherwise be lost.
    // Skips the very first connect (initial load already fetches everything).
    let wasDown = false;
    effect(() => {
      const state = this.signalR.connectionState();
      if (state === 'reconnecting' || state === 'disconnected') {
        wasDown = true;
      } else if (state === 'connected' && wasDown) {
        wasDown = false;
        void this.reconcileActiveWorkspace();
      }
    });
  }

  /** A DM member's display name: the caller's private friend nickname ?? their username. */
  protected dmMemberName(p: DmParticipant): string {
    return this.nicknameStore.nicknameOf(p.userId) ?? p.username;
  }

  /** Best-effort `#channel` / DM name for a mention toast — null if that guild isn't loaded. */
  private resolveChannelName(guildId: string | null, channelId: string): string | null {
    if (!guildId) {
      const dm = this.dmStore.find(channelId);
      return dm ? dmLabel(dm, (p) => this.dmMemberName(p)) : null;
    }
    const channel = this.channelStore.channelsByGuild()[guildId]?.find((c) => c.id === channelId);
    return channel ? `#${channel.name}` : null;
  }

  /** "Member Since" date for the DM profile panel, derived from the peer's snowflake id. */
  protected memberSince(userId: string): string {
    const date = snowflakeToDate(userId);
    return date ? date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  /** Opens the full-screen guild settings overlay for the active guild (open to every member). */
  protected openGuildSettings(): void {
    const guildId = this.activeGuildId();
    if (guildId) void this.router.navigate(['/app/guilds', guildId, 'settings']);
  }

  // Add-people modal for the active group DM (opened from the profile panel).
  protected readonly showAddPeople = signal(false);
  // Ids already in the group — passed to the modal so they're filtered from the pick list.
  protected readonly dmMemberIds = computed(() => this.dmMembers().map((p) => p.userId));

  protected openAddPeople(): void {
    this.showAddPeople.set(true);
  }

  /** Leaves the active group DM and returns to the friends screen. */
  protected leaveGroup(): void {
    const dm = this.dmChannel();
    if (!dm?.isGroup) return;
    this.dmStore.leave(dm.channelId);
    void this.router.navigate(['/app/friends']);
  }

  async ngOnInit(): Promise<void> {
    // Get the hub client synchronously and wire all server→store subscriptions BEFORE the socket
    // starts. The client's event Subjects persist across reconnects, so subscribing up-front means a
    // failed or slow initial connect can never leave the session deaf — the old `if (!client) return`
    // skipped every subscription for the whole session whenever the first connect lost its race.
    const client = this.signalR.getOrCreateClient();
    this.wireEvents(client);

    // Start the socket (self-retrying inside the service) and load guilds in parallel.
    await Promise.all([
      this.signalR.connect().catch(() => {}),
      this.guildStore.loadGuilds(),
    ]);
    this.unreadStore.loadAll();
    this.presenceStore.initMyStatus();
    this.friendStore.load();
    this.dmStore.load();
    this.nicknameStore.load();
    this.notificationStore.load();

    // Start reporting inactivity (auto-away). The idle service tolerates a not-yet-live client.
    this.idle.start(client);

    // Record desired membership in every guild so channel CRUD events arrive for all servers; the
    // service joins them now if connected and re-flushes them automatically on each reconnect.
    await this.joinAllGuilds();
  }

  /** Wires every server→store event stream. Independent of connection success — see ngOnInit. */
  private wireEvents(client: HarmonyHubClient): void {
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
    this.subs.add(client.messageDeleted$.subscribe((id) => {
      this.messageStore.deleteMessage(id);
      this.pinStore.applyMessageDeleted(id);
    }));
    this.subs.add(client.messageFailed$.subscribe((p) => this.messageStore.handleFailed(p)));
    this.subs.add(client.messagePinned$.subscribe((p) =>
      this.pinStore.applyPinned(p.channelId, p.messageId)));
    this.subs.add(client.messageUnpinned$.subscribe((p) =>
      this.pinStore.applyUnpinned(p.channelId, p.messageId)));
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
      if (p.type === 'mention' && p.channelId) {
        // A mention in the channel you're already viewing shouldn't ping — record it read
        // immediately so it lands in history without bumping the badge.
        if (p.channelId === this.messageStore.activeChannelId()) {
          this.notificationStore.markRead(p.id);
        } else {
          // Otherwise raise a (aggregating) mention toast that jumps to the message on click.
          const route = p.guildId
            ? ['/app/guilds', p.guildId, 'channels', p.channelId]
            : ['/app/dm', p.channelId];
          this.toast.pushMention(this.resolveChannelName(p.guildId, p.channelId), route);
        }
      }
    }));

    // Member moderation events. MemberRemoved/MemberUpdated reach the whole guild group;
    // Kicked reaches only the affected user, so any emission means *we* were removed.
    this.subs.add(client.memberRemoved$.subscribe((p) =>
      this.memberStore.removeMember(p.guildId, p.userId)));
    // The payload carries the member's full mutable state — apply both fields so neither clobbers
    // the other (a nickname change and a timeout change share this one event).
    this.subs.add(client.memberUpdated$.subscribe((p) =>
      this.memberStore.patchMember(p.guildId, p.userId, {
        nickname: p.nickname,
        communicationDisabledUntil: p.communicationDisabledUntil,
      })));
    this.subs.add(client.kicked$.subscribe((p) => this.handleKicked(p.guildId)));

    // Role events → stores. RoleCreated/Updated upsert; deletes prune; member-role changes patch
    // the affected member's role-id set (drives role-derived UI like colors/badges).
    this.subs.add(client.roleUpserted$.subscribe((r) => this.roleStore.applyRoleUpserted(r)));
    this.subs.add(client.roleDeleted$.subscribe((p) =>
      this.roleStore.applyRoleDeleted(p.guildId, p.roleId)));
    this.subs.add(client.memberRoleUpdated$.subscribe((p) =>
      this.memberStore.applyMemberRoleUpdated(p.guildId, p.userId, p.roleIds)));

    // A DM/group membership change (group created, participant added, someone left) → resync the
    // DM list. If it's the channel we're viewing, (re)join its group so a just-added member starts
    // receiving live messages.
    this.subs.add(client.dmChannelUpdated$.subscribe((channelId) => {
      this.dmStore.resync();
      if (channelId === this.messageStore.activeChannelId()) this.signalR.joinChannel(channelId);
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.idle.stop();
    this.signalR.disconnect();
  }

  /** We were kicked or banned from a guild: drop it locally, leave its group, and navigate out if open. */
  private async handleKicked(guildId: string): Promise<void> {
    const wasViewing = this.router.url.includes(`/guilds/${guildId}`);
    await this.signalR.leaveGuild(guildId);
    this.guildStore.removeGuild(guildId);
    if (wasViewing) this.router.navigate(['/friends']);
  }

  private async joinAllGuilds(): Promise<void> {
    for (const guild of this.guildStore.guilds()) {
      await this.signalR.joinGuild(guild.id);
    }
  }

  /**
   * After the socket recovers from a drop, re-pull the active workspace's live-changing collections —
   * group re-joins alone (handled by the service) don't recover events missed while offline.
   */
  private async reconcileActiveWorkspace(): Promise<void> {
    this.unreadStore.loadAll();

    const guildId = this.activeGuildId();
    if (guildId) {
      this.memberStore.reload(guildId).catch(() => {});
      this.roleStore.reload(guildId).catch(() => {});
    }

    // Re-fetch the open channel's messages so anything sent during the gap appears without a refresh.
    const channelId = this.messageStore.activeChannelId();
    if (channelId) {
      this.messageStore
        .loadMessages(this.messageStore.activeGuildId(), channelId)
        .catch(() => {});
    }
  }
}
