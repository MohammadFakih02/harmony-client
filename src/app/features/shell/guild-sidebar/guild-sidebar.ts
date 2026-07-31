import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { UiModal, ConfirmService } from '../../../shared/ui';
import { GuildStore } from '../../../core/stores/guild.store';
import { FriendStore } from '../../../core/stores/friend.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { DmStore } from '../../../core/stores/dm.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { MemberStore } from '../../../core/stores/member.store';
import { MUTE_DURATIONS } from '../../../core/models/mute.models';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { ToastService } from '../../../core/services/toast.service';
import { ContextMenuEntry } from '../../../core/models/context-menu.models';
import { GuildSummary } from '../../../core/models/guild.models';
import {
  DirectMessageChannel,
  dmLabel,
  dmPeer,
} from '../../../core/models/direct-message.models';
import { JoinServerModal } from '../../guilds/join-server-modal/join-server-modal';
import { publicFileUrl } from '../../../shared/util/public-file-url';

@Component({
  selector: 'app-guild-sidebar',
  standalone: true,
  imports: [RouterLink, FormsModule, JoinServerModal, OverlayModule, DragDropModule, UiModal],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './guild-sidebar.html',
  styleUrl: './guild-sidebar.scss',
})
export class GuildSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly friendStore = inject(FriendStore);
  protected readonly unreadStore = inject(UnreadStore);
  protected readonly dmStore = inject(DmStore);
  protected readonly muteStore = inject(MuteStore);
  private readonly memberStore = inject(MemberStore);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly confirmService = inject(ConfirmService);

  /** Right-click a rail icon — the server dropdown's actions, reachable without opening the server. */
  protected openGuildMenu(event: MouseEvent, guild: GuildSummary): void {
    const owner = guild.ownerId === this.auth.currentUser()?.id;
    const muted = this.muteStore.isMuted('guild', guild.id);
    // Same gate as the channel-sidebar dropdown: only members with an actual settings pane see the
    // entry. Caps for a not-yet-visited guild aren't cached — kick a load so the next open is right.
    const caps = this.memberStore.capabilitiesOf(guild.id);
    if (!caps) void this.memberStore.loadCapabilitiesIfNeeded(guild.id);
    const canOpenSettings =
      !!caps && (caps.canManageGuild || caps.canManageRoles || caps.canBan || caps.canViewAuditLog);
    const entries: ContextMenuEntry[] = [
      muted
        ? {
            label: 'Unmute Server',
            icon: 'fa-bell',
            action: () => void this.muteStore.remove('guild', guild.id),
          }
        : {
            label: 'Mute Server',
            icon: 'fa-bell-slash',
            children: MUTE_DURATIONS.map((d) => ({
              label: d.label,
              action: () => void this.muteStore.mute('guild', guild.id, d.minutes),
            })),
          },
      { separator: true },
      ...(canOpenSettings
        ? [
            {
              label: 'Server Settings',
              icon: 'fa-gear',
              action: () => void this.router.navigate(['/app/guilds', guild.id, 'settings']),
            } satisfies ContextMenuEntry,
          ]
        : []),
      {
        label: 'Copy Server ID',
        icon: 'fa-hashtag',
        action: () =>
          void navigator.clipboard?.writeText(guild.id).then(() => this.toast.info('Copied server ID')),
      },
      { separator: true },
      owner
        ? {
            label: 'Delete Server',
            icon: 'fa-trash',
            danger: true,
            action: () => this.leaveOrDeleteGuild(guild, true),
          }
        : {
            label: 'Leave Server',
            icon: 'fa-arrow-right-from-bracket',
            danger: true,
            action: () => this.leaveOrDeleteGuild(guild, false),
          },
    ];
    this.contextMenu.open(event, entries);
  }

  private async leaveOrDeleteGuild(guild: GuildSummary, owner: boolean): Promise<void> {
    const message = owner
      ? `Delete “${guild.name}”? It moves to Trash — you can restore it from Settings → Trash within 30 days.`
      : `Leave “${guild.name}”?`;
    const ok = await this.confirmService.confirm({
      title: owner ? 'Delete Server' : 'Leave Server',
      message,
      confirmLabel: owner ? 'Delete Server' : 'Leave',
      danger: true,
    });
    if (!ok) return;
    try {
      if (owner) await this.guildStore.deleteGuild(guild.id);
      else await this.guildStore.leaveGuild(guild.id);
      if (this.activeRailGuildId() === guild.id) void this.router.navigate(['/app/friends']);
    } catch {
      // Best-effort — the API may reject (e.g. owner-can't-leave); leave local state untouched.
    }
  }

  /** Resolves a guild icon storage key to its public URL (raw keys don't load directly). */
  protected guildIconUrl(iconKey: string): string {
    return publicFileUrl(iconKey)!;
  }

  /** A muted guild shows no unread emphasis (dimmed icon, no count badge) in the rail. */
  protected isGuildMuted(guildId: string): boolean {
    return this.muteStore.isMuted('guild', guildId);
  }

  // Reactive current URL — drives which rail icon shows as selected. We derive the active guild
  // from the URL (not GuildStore.selectedGuildId, which stays stale on /friends), so that entering
  // Friends/DMs correctly deselects the last guild and selects the home logo.
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly activeRailGuildId = computed(() => {
    const m = this.url().match(/\/guilds\/([^/?#]+)/);
    return m ? m[1] : null;
  });
  protected readonly homeSelected = computed(() => this.activeRailGuildId() === null);

  // DMs with unread messages surface as avatar pills at the top of the rail (Discord-style),
  // so an incoming DM is reachable even while you're inside a server.
  protected readonly unreadDms = computed(() =>
    this.dmStore.dms().filter((d) => (this.unreadStore.counts()[d.channelId] ?? 0) > 0),
  );

  dmUnreadCount(channelId: string): number {
    return this.unreadStore.counts()[channelId] ?? 0;
  }

  dmInitials(username: string): string {
    return username
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  /** Rail-pill label for a DM: group name (or joined members) / the 1:1 peer's username. */
  dmLabelOf(dm: DirectMessageChannel): string {
    return dmLabel(dm, (p) => p.username);
  }

  /** Resolved image URL for the pill: the group icon (if set) or the 1:1 peer's avatar; null → initials. */
  dmAvatarOf(dm: DirectMessageChannel): string | null {
    const key = dm.isGroup ? dm.iconKey : (dmPeer(dm)?.avatarKey ?? null);
    return publicFileUrl(key);
  }

  openDm(channelId: string): void {
    this.router.navigate(['/app/dm', channelId]);
  }

  // "+" rail button opens a small Create / Join chooser. Rendered in a CDK overlay so it escapes
  // the guild rail's overflow-x-hidden (which would otherwise clip the right-anchored menu).
  protected readonly showAddMenu = signal(false);
  protected readonly showJoinModal = signal(false);
  protected readonly addMenuPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: 12 },
  ];

  protected readonly showCreateModal = signal(false);
  protected readonly guildName = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');

  protected readonly guildInitials = computed(() =>
    this.guildStore.guilds().reduce(
      (acc, g) => {
        acc[g.id] = g.name
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        return acc;
      },
      {} as Record<string, string>,
    ),
  );

  /** Drag-reorder the rail — optimistic store move + persisted order (reverts on failure). */
  protected onGuildDrop(event: CdkDragDrop<unknown>): void {
    void this.guildStore.reorderGuilds(event.previousIndex, event.currentIndex);
  }

  navigateToGuild(guildId: string): void {
    // Already viewing this guild → do nothing (re-navigating would blank the open
    // channel). Check the URL, not selectedGuildId (which stays stale on /friends).
    // The trailing-boundary check avoids snowflake-id prefix collisions.
    const url = this.router.url;
    if (url.includes(`/guilds/${guildId}/`) || url.endsWith(`/guilds/${guildId}`)) return;
    this.router.navigate(['/app/guilds', guildId]);
  }

  chooseCreate(): void {
    this.showAddMenu.set(false);
    this.openCreateModal();
  }

  chooseJoin(): void {
    this.showAddMenu.set(false);
    this.showJoinModal.set(true);
  }

  chooseDiscover(): void {
    this.showAddMenu.set(false);
    void this.router.navigate(['/app/discover']);
  }

  /** Right-click empty space in the rail (below/between icons) — the same chooser as the "+"
   *  button, reachable without hunting for it. Icon-specific menus stopPropagation, so this only
   *  fires when nothing more specific handled the click. */
  protected openRailMenu(event: MouseEvent): void {
    this.contextMenu.open(event, [
      { label: 'Create a Server', icon: 'fa-plus', action: () => this.chooseCreate() },
      { label: 'Join a Server', icon: 'fa-right-to-bracket', action: () => this.chooseJoin() },
      { label: 'Discover Servers', icon: 'fa-compass', action: () => this.chooseDiscover() },
    ]);
  }

  openCreateModal(): void {
    this.guildName.set('');
    this.error.set('');
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  async submitCreateGuild(): Promise<void> {
    const name = this.guildName().trim();
    if (!name) return;

    this.submitting.set(true);
    this.error.set('');
    try {
      const guild = await this.guildStore.createGuild(name);
      // The backend seeds a default #general — the guild route redirects into it on load.
      this.showCreateModal.set(false);
      this.router.navigate(['/app/guilds', guild.id]);
    } catch {
      this.error.set('Failed to create server. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  async logout(): Promise<void> {
    const ok = await this.confirmService.confirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log Out',
      danger: true,
    });
    if (ok) await this.auth.logout();
  }
}
