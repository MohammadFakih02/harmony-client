import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { Channel, ChannelCategory } from '../../../core/models/channel.models';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { ContextMenuEntry } from '../../../core/models/context-menu.models';
import { GuildStore } from '../../../core/stores/guild.store';
import { MemberStore } from '../../../core/stores/member.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { VoiceParticipant } from '../../../core/models/voice.models';
import { DmStore } from '../../../core/stores/dm.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { MUTE_DURATIONS } from '../../../core/models/mute.models';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { PreferredStatus, toAvatarStatus } from '../../../core/models/presence.models';
import {
  DirectMessageChannel,
  DmParticipant,
  dmLabel,
  dmPeer,
} from '../../../core/models/direct-message.models';
import { UiAvatar, UiIconButton } from '../../../shared/ui';
import { GroupDmModal } from '../../channels/group-dm-modal/group-dm-modal';
import { ChannelSettingsModal } from '../../channels/channel-settings-modal/channel-settings-modal';
import { InvitePeopleModal } from '../../guilds/invite-people-modal/invite-people-modal';
import { VoiceBar } from '../../voice/voice-bar/voice-bar';
import { delayedSignal } from '../../../shared/util/delayed-signal';
import { publicFileUrl } from '../../../shared/util/public-file-url';
import { GuildNotificationSettingsStore } from '../../../core/stores/guild-notification-settings.store';
import {
  NOTIFICATION_LEVEL_OPTIONS,
  NotificationLevel,
} from '../../../core/models/notification-setting.models';

interface StatusOption {
  value: PreferredStatus;
  label: string;
  dotClass: string;
  description?: string;
}

interface ExpiryOption {
  label: string;
  minutes: number | null; // null = don't clear
}

@Component({
  selector: 'app-channel-sidebar',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    UiAvatar,
    UiIconButton,
    FormsModule,
    OverlayModule,
    DragDropModule,
    GroupDmModal,
    ChannelSettingsModal,
    InvitePeopleModal,
    VoiceBar,
  ],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './channel-sidebar.html',
  styleUrl: './channel-sidebar.scss',
})
export class ChannelSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly channelStore = inject(ChannelStore);
  protected readonly memberStore = inject(MemberStore);
  protected readonly unreadStore = inject(UnreadStore);
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly voiceStore = inject(VoiceStore);
  protected readonly dmStore = inject(DmStore);
  protected readonly muteStore = inject(MuteStore);
  protected readonly nicknameStore = inject(NicknameStore);
  protected readonly guildNotif = inject(GuildNotificationSettingsStore);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly router = inject(Router);

  /** The channel being edited in the settings modal (row gear, or right-click → Edit Channel), or null. */
  protected readonly editingChannel = signal<Channel | null>(null);

  constructor() {
    // A DM/group peer isn't guaranteed to be covered by any other presence load — the guild
    // member-sidebar only loads guild members, and the friends list only loads friends, so a DM
    // partner who's neither stayed permanently "offline" until something else happened to fetch
    // them. This sidebar is mounted for the whole app session, so it's the one place that reliably
    // sees every DM you have — load (deduped) whenever the list changes.
    effect(() => {
      const ids = this.dmStore.dms().flatMap((dm) => dm.participants.map((p) => p.userId));
      if (ids.length) void this.presenceStore.loadStatuses(ids);
    });
  }

  /**
   * Right-click a channel row = "everything else" (Discord's split): Mute + Notification Settings
   * (personal, every member) and Move to Category / Edit / Delete (ManageChannels). The row's
   * hover gear is the single-purpose counterpart — see openChannelGear below.
   */
  protected openChannelMenu(event: MouseEvent, channel: Channel): void {
    const entries: ContextMenuEntry[] = [];

    // Mute — a personal preference, so every member gets it.
    if (this.muteStore.isMuted('channel', channel.id)) {
      entries.push({
        label: 'Unmute Channel',
        icon: 'fa-bell',
        action: () => void this.muteStore.remove('channel', channel.id),
      });
    } else {
      entries.push({
        label: 'Mute Channel',
        icon: 'fa-bell-slash',
        children: MUTE_DURATIONS.map((d) => ({
          label: d.label,
          action: () => void this.muteStore.mute('channel', channel.id, d.minutes),
        })),
      });
    }

    entries.push({
      label: 'Notification Settings',
      icon: 'fa-gear',
      children: [
        {
          label: 'Use Server Default',
          checked: () => this.channelNotifLevel(channel.id) === null,
          keepOpen: true,
          action: () => this.setChannelNotif(channel.id, null),
        },
        ...this.notifLevelOptions.map((opt) => ({
          label: opt.label,
          checked: () => this.channelNotifLevel(channel.id) === opt.value,
          keepOpen: true,
          action: () => this.setChannelNotif(channel.id, opt.value),
        })),
      ],
    });

    if (this.canManageChannels()) {
      const categories = this.channelStore.currentCategories();
      entries.push(
        { separator: true },
        {
          label: 'Move to Category',
          icon: 'fa-folder',
          children: [
            {
              label: 'No Category',
              checked: () => channel.categoryId === null,
              action: () => void this.channelStore.moveToCategory(channel.guildId, channel.id, null),
            },
            ...categories
              .filter((c) => c.id !== null)
              .map((c) => ({
                label: c.name,
                checked: () => channel.categoryId === c.id,
                action: () => void this.channelStore.moveToCategory(channel.guildId, channel.id, c.id),
              })),
          ],
        },
        {
          label: 'Edit Channel',
          icon: 'fa-pen',
          action: () => this.editingChannel.set(channel),
        },
        {
          label: 'Delete Channel',
          icon: 'fa-trash',
          danger: true,
          action: () => void this.deleteChannel(channel),
        },
      );
    }

    this.contextMenu.open(event, entries);
  }

  /** Row gear (hover): the single-purpose shortcut. Managers → Edit Channel directly;
   *  everyone else → the Notification Settings popover (the only thing there is to set). */
  protected openChannelGear(channel: Channel, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.canManageChannels()) {
      this.editingChannel.set(channel);
    } else {
      this.openChannelNotif(channel.id, event);
    }
  }

  /** Right-click a category header → Create Channel / Rename / Delete (ManageChannels only). */
  protected openCategoryMenu(event: MouseEvent, category: ChannelCategory): void {
    if (!this.canManageChannels() || category.id === null) return;
    const categoryId = category.id;
    const entries: ContextMenuEntry[] = [
      {
        label: 'Create Channel',
        icon: 'fa-plus',
        action: () => this.openCreateChannel(),
      },
      {
        label: 'Rename Category',
        icon: 'fa-pen',
        action: () => void this.renameCategory(categoryId, category.name),
      },
      { separator: true },
      {
        label: 'Delete Category',
        icon: 'fa-trash',
        danger: true,
        action: () => void this.deleteCategory(categoryId, category.name),
      },
    ];
    this.contextMenu.open(event, entries);
  }

  private async renameCategory(categoryId: string, currentName: string): Promise<void> {
    const guildId = this.guildStore.selectedGuildId();
    if (!guildId) return;
    const name = window.prompt('Category name', currentName)?.trim();
    if (!name || name === currentName) return;
    try {
      await this.channelStore.saveChannel(guildId, categoryId, { name });
    } catch {
      // Best-effort — the settings modal is the fallback if this silently fails.
    }
  }

  private async deleteCategory(categoryId: string, name: string): Promise<void> {
    const guildId = this.guildStore.selectedGuildId();
    if (!guildId) return;
    if (!window.confirm(`Delete category "${name}"? Its channels move to the top level.`)) return;
    try {
      await this.channelStore.deleteChannel(guildId, categoryId);
    } catch {
      // Best-effort — the store reverts its optimistic removal on failure.
    }
  }

  /** Cross-category drag-and-drop: dropping in a different category's list moves the channel;
   *  dropping within the same list reorders (existing onChannelDrop behavior). */
  protected onChannelDropAcross(event: CdkDragDrop<Channel[]>, category: ChannelCategory): void {
    if (event.previousContainer === event.container) {
      this.onChannelDrop(event, category);
      return;
    }
    const guildId = this.guildStore.selectedGuildId();
    const moved = event.previousContainer.data[event.previousIndex];
    if (!guildId || !moved) return;
    void this.channelStore.moveToCategory(guildId, moved.id, category.id);
  }

  /** Every rendered category's drop-list id, so cdkDropListConnectedTo can link them all —
   *  without this, a channel could only reorder within its own category, never move between. */
  protected readonly categoryDropListIds = computed(() =>
    this.channelStore.currentCategories().map((c) => this.categoryDropListId(c.id)),
  );

  protected categoryDropListId(categoryId: string | null): string {
    return `channel-category-${categoryId ?? 'none'}`;
  }

  /** Right-click empty space below the categories/channels — Create Channel/Category
   *  (ManageChannels only; a plain member has nothing to do here, so the native menu shows). */
  protected openChannelListMenu(event: MouseEvent): void {
    if (!this.canManageChannels()) return;
    this.contextMenu.open(event, [
      { label: 'Create Channel', icon: 'fa-plus', action: () => this.openCreateChannel() },
      { label: 'Create Category', icon: 'fa-folder-plus', action: () => this.openCreateCategory() },
    ]);
  }

  /** Right-click empty space in the DM list — same "New Group" affordance as the header +. */
  protected openDmListMenu(event: MouseEvent): void {
    this.contextMenu.open(event, [
      { label: 'Create Group DM', icon: 'fa-user-group', action: () => this.openGroupModal() },
    ]);
  }

  private async deleteChannel(channel: Channel): Promise<void> {
    const guildId = this.guildStore.selectedGuildId();
    if (!guildId) return;
    if (!window.confirm(`Delete #${channel.name}? This can't be undone.`)) return;
    const wasActive = this.channelStore.selectedChannelId() === channel.id;
    try {
      await this.channelStore.deleteChannel(guildId, channel.id);
      if (wasActive) {
        const fallback = this.channelStore.resolveDefaultChannel(guildId);
        void this.router.navigate(
          fallback
            ? ['/app/guilds', guildId, 'channels', fallback]
            : ['/app/guilds', guildId],
        );
      }
    } catch {
      // Best-effort — the store reverts its optimistic removal on failure.
    }
  }

  /** DM display name: group name (or joined member names) / the 1:1 peer's friend-nickname ?? username. */
  protected dmDisplayName(dm: DirectMessageChannel): string {
    return dmLabel(dm, (p) => this.dmMemberName(p));
  }

  private dmMemberName(p: DmParticipant): string {
    return this.nicknameStore.nicknameOf(p.userId) ?? p.username;
  }

  /** The 1:1 peer of a DM (undefined for a group) — drives the row's avatar + status dot. */
  protected dmOneToOnePeer(dm: DirectMessageChannel): DmParticipant | undefined {
    return dmPeer(dm);
  }

  protected readonly publicFileUrl = publicFileUrl;

  // --- Voice channels (LiveKit Slice 2) — click to join; roster renders inline under the row. ---

  /** Clicking a voice channel connects to it AND opens its stage in the main pane (Discord-style). */
  protected joinVoice(channel: Channel): void {
    void this.voiceStore.join(channel.id);
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.router.navigate(['/app/guilds', guildId, 'channels', channel.id]);
  }

  /** Live voice roster for a channel. */
  protected voiceParticipants(channelId: string): VoiceParticipant[] {
    return this.voiceStore.participantsOf(channelId);
  }

  /** A voice participant's display name: guild nickname ?? friend nickname ?? username. */
  protected voiceName(userId: string): string {
    const guildId = this.guildStore.selectedGuildId();
    const member = guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === userId)
      : undefined;
    return member?.nickname ?? this.nicknameStore.nicknameOf(userId) ?? member?.username ?? 'Unknown';
  }

  /** A voice participant's avatar key (from the guild member list), or null. */
  protected voiceAvatar(userId: string): string | null {
    const guildId = this.guildStore.selectedGuildId();
    const member = guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === userId)
      : undefined;
    return member?.avatarKey ?? null;
  }

  /** Whether a participant is currently speaking (LiveKit active-speaker detection). */
  protected isSpeaking(userId: string): boolean {
    return this.voiceStore.speakingUserIds().has(userId);
  }

  // Guild-level capabilities (resolved server-side, loaded by the shell) — gate management UI.
  // Channel create/settings need ManageChannels; the invite affordance needs CreateInvite.
  protected readonly canManageChannels = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildStore.selectedGuildId() ?? '')?.canManageChannels,
  );
  protected readonly canCreateInvite = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildStore.selectedGuildId() ?? '')?.canCreateInvite,
  );
  protected readonly isGuildOwner = computed(
    () => this.guildStore.selectedGuild()?.ownerId === this.auth.currentUser()?.id,
  );

  /** Drag-reorder within a category group (ManageChannels; the drop list is disabled otherwise). */
  protected onChannelDrop(event: CdkDragDrop<Channel[]>, category: ChannelCategory): void {
    if (event.previousIndex === event.currentIndex) return;
    const guildId = this.guildStore.selectedGuildId();
    if (!guildId) return;
    const ids = category.channels.map((c) => c.id);
    const [moved] = ids.splice(event.previousIndex, 1);
    if (!moved) return;
    ids.splice(event.currentIndex, 0, moved);
    void this.channelStore.reorderChannels(guildId, ids);
  }

  // Server dropdown (guild-header ▾) — a CDK overlay so it escapes the sidebar's overflow-hidden.
  // The single home for Invite / Create Channel / Server Settings / Leave (the top bar no longer
  // duplicates these). Actions gate on the resolved capabilities.
  protected readonly showServerMenu = signal(false);
  protected readonly serverMenuPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  ];
  protected readonly showInviteModal = signal(false);

  toggleServerMenu(): void {
    this.showServerMenu.set(!this.showServerMenu());
  }

  openInvitePeople(): void {
    this.showServerMenu.set(false);
    this.showInviteModal.set(true);
  }

  createChannelFromMenu(): void {
    this.showServerMenu.set(false);
    this.openCreateChannel();
  }

  openServerSettings(): void {
    this.showServerMenu.set(false);
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.router.navigate(['/app/guilds', guildId, 'settings']);
  }

  /** Whether the active guild is muted (suppresses its unread emphasis + rail badge). */
  protected readonly selectedGuildMuted = computed(() => {
    const guildId = this.guildStore.selectedGuildId();
    return !!guildId && this.muteStore.isMuted('guild', guildId);
  });

  muteServer(): void {
    this.showServerMenu.set(false);
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.muteStore.mute('guild', guildId, null);
  }

  unmuteServer(): void {
    this.showServerMenu.set(false);
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.muteStore.remove('guild', guildId);
  }

  /** Owner → delete the server; member → leave it. Both confirm first, then navigate home. */
  async leaveOrDeleteServer(): Promise<void> {
    this.showServerMenu.set(false);
    const guildId = this.guildStore.selectedGuildId();
    const guild = this.guildStore.selectedGuild();
    if (!guildId || !guild) return;
    const owner = this.isGuildOwner();
    const message = owner
      ? `Delete “${guild.name}”? This permanently removes the server for everyone.`
      : `Leave “${guild.name}”?`;
    if (!window.confirm(message)) return;
    try {
      if (owner) await this.guildStore.deleteGuild(guildId);
      else await this.guildStore.leaveGuild(guildId);
      void this.router.navigate(['/app/friends']);
    } catch {
      // Best-effort — the API may reject (e.g. owner-can't-leave); leave local state untouched.
    }
  }

  // Per-channel notification-level popover (the channel-row ⚙ — a personal preference, so it's
  // available to every member, not just managers). Later this gear can grow into full channel
  // settings (nsfw / slowmode / limits / rename); for now it sets the notification level.
  protected readonly channelNotifTarget = signal<string | null>(null);
  protected readonly channelNotifPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
  ];
  protected readonly notifLevelOptions = NOTIFICATION_LEVEL_OPTIONS;

  openChannelNotif(channelId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.guildNotif.load(guildId); // so the current level renders as checked
    this.channelNotifTarget.set(this.channelNotifTarget() === channelId ? null : channelId);
  }

  /** The channel's explicit notification level, or null = "use server default". */
  channelNotifLevel(channelId: string): NotificationLevel | null {
    const guildId = this.guildStore.selectedGuildId();
    if (!guildId) return null;
    return (
      this.guildNotif.settingsOf(guildId)?.channels.find((c) => c.channelId === channelId)?.level ??
      null
    );
  }

  setChannelNotif(channelId: string, level: NotificationLevel | null): void {
    const guildId = this.guildStore.selectedGuildId();
    if (guildId) void this.guildNotif.setChannelLevel(guildId, channelId, level);
    this.channelNotifTarget.set(null);
  }

  // Delayed so a fast (cached/quick) channel fetch doesn't flash the spinner.
  protected readonly showLoading = delayedSignal(this.channelStore.loading);

  // The home column (Friends + DM list) shows whenever we're not inside a guild.
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly inDirectMessages = computed(() => !this.url().includes('/guilds/'));
  protected readonly activeDmChannelId = computed(() => {
    const m = this.url().match(/\/dm\/([^/?#]+)/);
    return m ? m[1] : null;
  });

  dmAvatarStatus(userId: string): ReturnType<typeof toAvatarStatus> {
    return toAvatarStatus(this.presenceStore.statusOf(userId));
  }

  // The hover ✕ hides a 1:1 (it reappears on a new message) but *leaves* a group (permanent).
  removeDm(dm: DirectMessageChannel, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (dm.isGroup) this.dmStore.leave(dm.channelId);
    else this.dmStore.hide(dm.channelId);
    if (this.activeDmChannelId() === dm.channelId) this.router.navigate(['/app/friends']);
  }

  /** Right-click a DM row — Mute (a DM is a channel, so it reuses the channel mute target)
   *  + Close/Leave, plus Copy Channel ID (everything the hover ✕ does, plus what it can't). */
  protected openDmMenu(event: MouseEvent, dm: DirectMessageChannel): void {
    const muted = this.muteStore.isMuted('channel', dm.channelId);
    const entries: ContextMenuEntry[] = [
      muted
        ? {
            label: 'Unmute Conversation',
            icon: 'fa-bell',
            action: () => void this.muteStore.remove('channel', dm.channelId),
          }
        : {
            label: 'Mute Conversation',
            icon: 'fa-bell-slash',
            children: MUTE_DURATIONS.map((d) => ({
              label: d.label,
              action: () => void this.muteStore.mute('channel', dm.channelId, d.minutes),
            })),
          },
      { separator: true },
      {
        label: 'Copy Channel ID',
        icon: 'fa-hashtag',
        action: () => void navigator.clipboard?.writeText(dm.channelId),
      },
      { separator: true },
      dm.isGroup
        ? {
            label: 'Leave Group',
            icon: 'fa-arrow-right-from-bracket',
            danger: true,
            action: () => this.removeDmFromMenu(dm),
          }
        : {
            label: 'Close DM',
            icon: 'fa-xmark',
            action: () => this.removeDmFromMenu(dm),
          },
    ];
    this.contextMenu.open(event, entries);
  }

  private removeDmFromMenu(dm: DirectMessageChannel): void {
    if (dm.isGroup) this.dmStore.leave(dm.channelId);
    else this.dmStore.hide(dm.channelId);
    if (this.activeDmChannelId() === dm.channelId) this.router.navigate(['/app/friends']);
  }

  // New-group creation modal (from the DM header +).
  protected readonly showGroupModal = signal(false);

  openGroupModal(): void {
    this.showGroupModal.set(true);
  }

  onGroupCreated(dm: DirectMessageChannel): void {
    this.router.navigate(['/app/dm', dm.channelId]);
  }

  protected readonly showCreateModal = signal(false);
  protected readonly channelName = signal('');
  protected readonly channelType = signal<'text' | 'voice' | 'category'>('text');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');

  // Status picker — two independent CDK overlays (so they escape the sidebar's
  // overflow-hidden) anchored above the user-deck avatar: a status-select menu and a
  // separate custom-status editor. Kept separate so picking a status or saving a message
  // doesn't tear down the other concern's popup.
  protected readonly showStatusMenu = signal(false);
  protected readonly showCustomStatus = signal(false);
  protected readonly statusOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
  ];
  protected readonly myAvatarStatus = computed(() => toAvatarStatus(this.presenceStore.myStatus()));
  protected readonly statusOptions: StatusOption[] = [
    { value: 'online', label: 'Online', dotClass: 'bg-success' },
    { value: 'away', label: 'Idle', dotClass: 'bg-warning' },
    {
      value: 'dnd',
      label: 'Do Not Disturb',
      dotClass: 'bg-danger',
      description: 'You will not receive notification pings.',
    },
    {
      value: 'invisible',
      label: 'Invisible',
      dotClass: 'bg-surface-3',
      description: 'You will appear offline.',
    },
  ];
  protected readonly expiryOptions: ExpiryOption[] = [
    { label: '15m', minutes: 15 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '2h', minutes: 120 },
    { label: '4h', minutes: 240 },
    { label: '8h', minutes: 480 },
    { label: '24h', minutes: 1440 },
    { label: "Don't clear", minutes: null },
  ];

  // "Clear after" duration applied to the next status pick (null = don't clear).
  protected readonly selectedExpiry = signal<number | null>(null);
  // Custom status draft + its own clear-after.
  protected readonly customDraft = signal('');
  protected readonly customExpiry = signal<number | null>(null);

  // Snapshot of "now", refreshed each time the picker opens — powers the time-left labels
  // without a perpetual interval (the popup is transient, so a value-on-open is enough).
  protected readonly now = signal(Date.now());

  // The status option matching the current preferred status — header dot + label.
  protected readonly currentStatusOption = computed(() =>
    this.statusOptions.find((o) => o.value === this.presenceStore.myStatus()),
  );

  // Human "clears in 42m" for the preferred status / custom message, or null when no expiry.
  protected readonly statusExpiryLabel = computed(() =>
    this.remainingLabel(this.presenceStore.myStatusExpiresAt()),
  );
  protected readonly customStatusExpiryLabel = computed(() =>
    this.remainingLabel(this.presenceStore.myStatusMessageExpiresAt()),
  );

  private remainingLabel(expiresAt: number | null): string | null {
    if (expiresAt == null) return null;
    const ms = expiresAt - this.now();
    if (ms <= 0) return null;
    const minutes = Math.ceil(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }

  toggleStatusMenu(): void {
    const opening = !this.showStatusMenu();
    if (opening) {
      this.now.set(Date.now()); // fresh reference for the time-left labels
      this.selectedExpiry.set(null); // reset the clear-after applied to the next pick
      this.showCustomStatus.set(false); // the two popups are mutually exclusive
    }
    this.showStatusMenu.set(opening);
  }

  /** Opens the separate custom-status editor, seeded from the current message. */
  openCustomStatus(): void {
    this.now.set(Date.now());
    this.customDraft.set(this.presenceStore.myStatusMessage() ?? '');
    this.customExpiry.set(null);
    this.showStatusMenu.set(false);
    this.showCustomStatus.set(true);
  }

  selectStatus(status: PreferredStatus): void {
    // Online is the default/revert target, so an expiry on it is meaningless.
    this.presenceStore.setMyStatus(status, status === 'online' ? null : this.selectedExpiry());
    this.showStatusMenu.set(false); // picking a status closes the menu
  }

  saveCustomStatus(): void {
    const message = this.customDraft().trim();
    this.presenceStore.setCustomStatus(message || null, message ? this.customExpiry() : null);
    this.showCustomStatus.set(false); // saving closes the editor
  }

  clearCustomStatus(): void {
    this.customDraft.set('');
    this.presenceStore.setCustomStatus(null);
  }

  toggleCategory(categoryId: string | null): void {
    if (categoryId !== null) this.channelStore.toggleCategory(categoryId);
  }

  openSettings(): void {
    void this.router.navigate(['/app/settings']);
  }

  openCreateChannel(): void {
    this.channelName.set('');
    this.channelType.set('text');
    this.error.set('');
    this.showCreateModal.set(true);
  }

  /** Server dropdown → Create Category — same modal, pre-set to the category type. */
  openCreateCategory(): void {
    this.showServerMenu.set(false);
    this.channelName.set('');
    this.channelType.set('category');
    this.error.set('');
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  async submitCreateChannel(): Promise<void> {
    const name = this.channelName().trim();
    const guildId = this.guildStore.selectedGuildId();
    if (!name || !guildId) return;

    this.submitting.set(true);
    this.error.set('');
    try {
      const channel = await this.channelStore.createChannel(guildId, name, this.channelType());
      this.showCreateModal.set(false);
      // A category isn't a navigable view — only text/voice channels have one.
      if (channel.type !== 'category') {
        this.router.navigate(['/app/guilds', guildId, 'channels', channel.id]);
      }
    } catch {
      this.error.set('Failed to create channel. Only the server owner can create channels.');
    } finally {
      this.submitting.set(false);
    }
  }
}
