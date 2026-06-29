import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { MemberStore } from '../../../core/stores/member.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { PreferredStatus, toAvatarStatus } from '../../../core/models/presence.models';
import { UiAvatar, UiIconButton } from '../../../shared/ui';
import { delayedSignal } from '../../../shared/util/delayed-signal';

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
  imports: [RouterLink, RouterLinkActive, UiAvatar, UiIconButton, FormsModule, OverlayModule],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './channel-sidebar.html',
  styleUrl: './channel-sidebar.scss',
})
export class ChannelSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly channelStore = inject(ChannelStore);
  protected readonly memberStore = inject(MemberStore);
  protected readonly unreadStore = inject(UnreadStore);
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly dmStore = inject(DmStore);
  protected readonly nicknameStore = inject(NicknameStore);
  private readonly router = inject(Router);

  /** DM display name: the caller's private friend nickname ?? the peer's username. */
  protected dmName(peerId: string, peerUsername: string): string {
    return this.nicknameStore.nicknameOf(peerId) ?? peerUsername;
  }

  // Guild-level capabilities (resolved server-side, loaded by the shell) — gate management UI.
  // Channel create/settings need ManageChannels; the invite affordance needs CreateInvite.
  protected readonly canManageChannels = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildStore.selectedGuildId() ?? '')?.canManageChannels,
  );
  protected readonly canCreateInvite = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildStore.selectedGuildId() ?? '')?.canCreateInvite,
  );

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

  hideDm(channelId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.dmStore.hide(channelId);
    if (this.activeDmChannelId() === channelId) this.router.navigate(['/app/friends']);
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
    // Apply without dismissing — the popup stays open so further tweaks don't reopen it.
    this.presenceStore.setMyStatus(status, status === 'online' ? null : this.selectedExpiry());
  }

  saveCustomStatus(): void {
    const message = this.customDraft().trim();
    this.presenceStore.setCustomStatus(message || null, message ? this.customExpiry() : null);
    // Keep the editor open — saving shouldn't tear the popup down.
  }

  clearCustomStatus(): void {
    this.customDraft.set('');
    this.presenceStore.setCustomStatus(null);
  }

  toggleCategory(categoryId: string | null): void {
    if (categoryId !== null) this.channelStore.toggleCategory(categoryId);
  }

  toggleTheme(): void {
    this.theme.toggle();
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
