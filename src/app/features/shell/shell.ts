import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith, Subscription } from 'rxjs';
import { SignalRService } from '../../core/services/signalr.service';
import { GatewayEvents } from '../../core/hub/gateway-events';
import { IdleService } from '../../core/services/idle.service';
import { GuildStore } from '../../core/stores/guild.store';
import { ChannelStore } from '../../core/stores/channel.store';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { MessageStore } from '../../core/stores/message.store';
import { PinStore } from '../../core/stores/pin.store';
import { TypingStore } from '../../core/stores/typing.store';
import { PinsPanel } from '../channels/pins-panel/pins-panel';
import { SearchPanel } from './search-panel/search-panel';
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
import { GroupDmModal } from '../channels/group-dm-modal/group-dm-modal';
import { UiAvatar, UiIconButton, Lightbox, ContextMenu } from '../../shared/ui';
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
    GroupDmModal,
    UiAvatar,
    UiIconButton,
    Lightbox,
    ToastContainer,
    UserProfileModal,
    ContextMenu,
    OverlayModule,
    PinsPanel,
    SearchPanel,
  ],
  templateUrl: './shell.html',
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly signalR = inject(SignalRService);
  private readonly gateway = inject(GatewayEvents);
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
  // Pinned-messages panel (header, guild + DM) — anchored under the pin button.
  protected readonly showPins = signal(false);
  protected readonly pinsPanelPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];
  // Server message search panel (guild header) — anchored under the search button.
  protected readonly showSearch = signal(false);
  protected readonly searchPanelPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];
  protected readonly activeGuildId = computed(() => this.guildStore.selectedGuildId());
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
  // Injected so PinStore is instantiated at boot and its gateway subscription (onInit) is live for
  // the whole session — not just while a channel view (its other injector) is mounted. Do not remove.
  private readonly pinStore = inject(PinStore);
  // Same reason for TypingStore — keep its gateway subscription alive from boot.
  private readonly typingStore = inject(TypingStore);
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
    // Build the hub client synchronously so the connection can start. Stores subscribe to the unified
    // gateway stream from their own onInit hooks (they're already constructed as fields above); the
    // shell only wires the handful of *location-aware* reactions that need the router / active
    // channel / connection — see wireResidualEvents.
    const client = this.signalR.getOrCreateClient();
    this.wireResidualEvents();

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

  /**
   * Wires only the *location-aware* / app-level reactions to the unified gateway stream — the ones
   * that depend on the active channel, the router, or the connection, and so don't belong to any one
   * store. Every pure own-state mutation now lives in its owning store's onInit (Pillar 2). Runs
   * independent of connection success — the gateway stream outlives any reconnect.
   */
  private wireResidualEvents(): void {
    this.subs.add(this.gateway.events$.subscribe((e) => {
      switch (e.type) {
        case 'MessageReceived':
          // A message in the channel you're currently viewing is already "read" — reset its count
          // so no badge appears on the active channel. (Appending it is the MessageStore's job.)
          if (e.message.channelId === this.messageStore.activeChannelId()) {
            this.unreadStore
              .markRead(e.message.guildId, e.message.channelId, e.message.messageId)
              .catch(() => {});
          }
          break;

        case 'UnreadCountUpdated':
          // Ignore increments for the channel you're viewing — you're reading it, not accruing.
          if (e.payload.channelId === this.messageStore.activeChannelId()) break;
          this.unreadStore.setCount(e.payload);
          break;

        case 'NotificationReceived':
          // The store already persisted it (its onInit). Here we only decide the mention's UX:
          // suppress+mark-read if it's for the channel you're viewing, else raise a jump toast.
          if (e.payload.type === 'mention' && e.payload.channelId) {
            if (e.payload.channelId === this.messageStore.activeChannelId()) {
              this.notificationStore.markRead(e.payload.id);
            } else {
              const route = e.payload.guildId
                ? ['/app/guilds', e.payload.guildId, 'channels', e.payload.channelId]
                : ['/app/dm', e.payload.channelId];
              this.toast.pushMention(
                this.resolveChannelName(e.payload.guildId, e.payload.channelId),
                route,
              );
            }
          }
          break;

        case 'Kicked':
          // Reaches only the affected user, so any emission means *we* were removed.
          void this.handleKicked(e.payload.guildId);
          break;

        case 'DmChannelUpdated':
          // The DmStore resynced the list; if it's the channel we're viewing, (re)join its group so
          // a just-added member starts receiving live messages.
          if (e.channelId === this.messageStore.activeChannelId()) {
            void this.signalR.joinChannel(e.channelId);
          }
          break;
      }
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
