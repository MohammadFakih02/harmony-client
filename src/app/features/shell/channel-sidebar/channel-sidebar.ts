import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { MemberStore } from '../../../core/stores/member.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { DmStore } from '../../../core/stores/dm.store';
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
import { InvitePeopleModal } from '../../guilds/invite-people-modal/invite-people-modal';
import { delayedSignal } from '../../../shared/util/delayed-signal';
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
    GroupDmModal,
    InvitePeopleModal,
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
  protected readonly dmStore = inject(DmStore);
  protected readonly nicknameStore = inject(NicknameStore);
  protected readonly guildNotif = inject(GuildNotificationSettingsStore);
  private readonly router = inject(Router);

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
  protected readonly channelType = signal<'text' | 'voice'>('text');
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
      this.router.navigate(['/app/guilds', guildId, 'channels', channel.id]);
    } catch {
      this.error.set('Failed to create channel. Only the server owner can create channels.');
    } finally {
      this.submitting.set(false);
    }
  }
}
