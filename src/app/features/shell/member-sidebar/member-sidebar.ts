import { Component, inject, effect, computed, signal, OnDestroy } from '@angular/core';
import { CdkOverlayOrigin, ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { Router } from '@angular/router';
import { UiAvatar } from '../../../shared/ui';
import { GuildStore } from '../../../core/stores/guild.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { DmStore } from '../../../core/stores/dm.store';
import { AuthService } from '../../../core/services/auth.service';
import { RoleService } from '../../../core/services/role.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { ToastService } from '../../../core/services/toast.service';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { buildUserMenu, UserMenuDeps } from '../user-context-menu';
import { GuildMember } from '../../../core/models/member.models';
import { memberColor, memberHoistRole } from '../../../core/models/role.models';
import { toAvatarStatus } from '../../../core/models/presence.models';
import { UserProfilePopout } from '../user-profile-popout/user-profile-popout';

interface MemberRow {
  member: GuildMember;
  status: ReturnType<typeof toAvatarStatus>;
  statusMessage: string | null;
  timedOut: boolean;
  moderatable: boolean;
  dimmed: boolean; // offline members render dimmed (Discord-style)
  color: string | null; // highest-role colour for the username, or null
}

interface MemberSection {
  key: string; // role id, '_online' for the ungrouped-online bucket, or '_offline'
  label: string;
  rows: MemberRow[];
}

@Component({
  selector: 'app-member-sidebar',
  standalone: true,
  imports: [UiAvatar, OverlayModule, UserProfilePopout],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './member-sidebar.html',
})
export class MemberSidebar implements OnDestroy {
  protected readonly guildStore = inject(GuildStore);
  protected readonly channelStore = inject(ChannelStore);
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly memberStore = inject(MemberStore);
  protected readonly roleStore = inject(RoleStore);
  private readonly auth = inject(AuthService);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly userMenuDeps: UserMenuDeps = {
    memberStore: this.memberStore,
    roleStore: this.roleStore,
    roleService: inject(RoleService),
    dmStore: inject(DmStore),
    profileModal: inject(ProfileModalService),
    toast: inject(ToastService),
    router: inject(Router),
    auth: this.auth,
  };

  // Wall-clock signal so the timed-out indicator clears itself when a timeout lapses. A timeout
  // emits MemberUpdated only when it's set or manually cleared — never on natural expiry — so we
  // re-evaluate against the clock here. Gated on an active timeout (vs. the last tick's value) so
  // the tick that crosses the expiry fires once to clear the icon, then we idle until the next one.
  private readonly now = signal(Date.now());
  private readonly ticker = setInterval(() => {
    const prev = this.now();
    if (this.members().some((m) => m.communicationDisabledUntil != null && m.communicationDisabledUntil > prev)) {
      this.now.set(Date.now());
    }
  }, 15000);

  protected readonly members = computed<GuildMember[]>(() => {
    const guildId = this.guildStore.selectedGuildId();
    return guildId ? this.memberStore.membersOf(guildId) : [];
  });

  // Only members who can ViewChannel the open channel are listed, so override-hidden channels
  // (e.g. #staff) don't reveal who's in them. The viewer set is resolved server-side; until it
  // loads (or if it fails) we show everyone rather than flashing an over-restricted list.
  protected readonly visibleMembers = computed<GuildMember[]>(() => {
    const all = this.members();
    const channelId = this.channelStore.selectedChannelId();
    if (!channelId) return all;
    const viewers = this.memberStore.channelViewers(channelId);
    if (!viewers) return all;
    const set = new Set(viewers);
    return all.filter((m) => set.has(m.userId));
  });

  protected readonly caps = computed(() => {
    const guildId = this.guildStore.selectedGuildId();
    return guildId ? this.memberStore.capabilitiesOf(guildId) : null;
  });

  /** Whether the caller can run any member action (moderation or role assignment) — drives the row menu. */
  protected readonly canModerateAny = computed(() => {
    const c = this.caps();
    return !!c && (c.canKick || c.canBan || c.canTimeout || c.canManageRoles);
  });

  // The active guild's roles, rank-sorted (RoleStore.rolesOf already sorts) — drives both the
  // hoisted-role member sections and each member's username colour.
  private readonly roles = computed(() => {
    const guildId = this.guildStore.selectedGuildId();
    return guildId ? this.roleStore.rolesOf(guildId) : [];
  });

  // Members grouped Discord-style: online members first, split by their highest hoisted role (rank
  // order) with an "Online" bucket for the un-hoisted, then ALL offline members collapse into a
  // single "Offline" bucket at the bottom regardless of role. Each row bakes in status/colour so the
  // view tracks the presence + role signals directly (a per-row method binding wouldn't re-render on
  // a live status change).
  protected readonly sections = computed<MemberSection[]>(() => {
    const statuses = this.presenceStore.statuses();
    const messages = this.presenceStore.statusMessages();
    const now = this.now();
    const roles = this.roles();

    const isOnline = (m: GuildMember) => (statuses[m.userId] ?? 'offline') !== 'offline';
    const buildRow = (member: GuildMember): MemberRow => ({
      member,
      status: toAvatarStatus(statuses[member.userId] ?? 'offline'),
      statusMessage: messages[member.userId] ?? null,
      timedOut:
        member.communicationDisabledUntil != null && member.communicationDisabledUntil > now,
      moderatable: this.canModerate(member),
      dimmed: !isOnline(member),
      color: memberColor(member.roleIds, roles),
    });
    const byName = (a: GuildMember, b: GuildMember) =>
      this.displayName(a).localeCompare(this.displayName(b));

    const online: GuildMember[] = [];
    const offline: GuildMember[] = [];
    for (const m of this.visibleMembers()) (isOnline(m) ? online : offline).push(m);

    // Online → group by highest hoisted role; the rest go in the "Online" bucket.
    const byRole = new Map<string, GuildMember[]>();
    const onlineUngrouped: GuildMember[] = [];
    for (const m of online) {
      const hoist = memberHoistRole(m.roleIds, roles);
      if (hoist) (byRole.get(hoist.id) ?? byRole.set(hoist.id, []).get(hoist.id)!).push(m);
      else onlineUngrouped.push(m);
    }

    const sections: MemberSection[] = [];
    for (const role of roles.filter((r) => r.isHoisted)) {
      const members = byRole.get(role.id);
      if (members?.length) {
        sections.push({ key: role.id, label: role.name, rows: members.sort(byName).map(buildRow) });
      }
    }
    if (onlineUngrouped.length) {
      sections.push({ key: '_online', label: 'Online', rows: onlineUngrouped.sort(byName).map(buildRow) });
    }
    if (offline.length) {
      sections.push({ key: '_offline', label: 'Offline', rows: offline.sort(byName).map(buildRow) });
    }
    return sections;
  });

  // --- profile popout (opened by a plain row click; opens leftward out of the right sidebar) ---
  protected readonly profileMember = signal<GuildMember | null>(null);
  protected readonly profileOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly profilePositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -8 },
    { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'bottom', offsetX: -8 },
  ];

  constructor() {
    effect(() => {
      const guildId = this.guildStore.selectedGuildId();
      if (!guildId) return;
      this.memberStore.loadCapabilitiesIfNeeded(guildId);
      this.memberStore.loadIfNeeded(guildId).then(() => {
        // Fetch current presence for these members; live changes arrive via SignalR.
        this.presenceStore.loadStatuses(this.memberStore.membersOf(guildId).map((m) => m.userId));
      });
    });

    // Resolve which members can view the open channel (server-side), so the list hides members
    // an override excludes. Cached per channel, so re-opening a channel is instant.
    effect(() => {
      const guildId = this.guildStore.selectedGuildId();
      const channelId = this.channelStore.selectedChannelId();
      if (guildId && channelId) this.memberStore.loadViewersIfNeeded(guildId, channelId);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.ticker);
  }

  /** A member is moderatable if the caller has a mod cap and the target isn't themselves or the owner. */
  protected canModerate(m: GuildMember): boolean {
    return this.canModerateAny() && !m.isOwner && m.userId !== this.auth.currentUser()?.id;
  }

  /** Right-click a row (or click the ⋮) → the unified user context menu (profile/message/moderation). */
  protected openUserMenu(event: MouseEvent, member: GuildMember): void {
    this.closeProfile();
    this.contextMenu.open(
      event,
      buildUserMenu(this.userMenuDeps, {
        userId: member.userId,
        guildId: this.guildStore.selectedGuildId(),
        username: member.username,
        member,
        caps: this.caps(),
      }),
    );
  }

  protected openProfile(member: GuildMember, origin: CdkOverlayOrigin): void {
    this.profileOrigin.set(origin);
    this.profileMember.set(member);
  }

  protected closeProfile(): void {
    this.profileMember.set(null);
    this.profileOrigin.set(null);
  }

  protected displayName(m: GuildMember): string {
    return m.nickname ?? m.username;
  }
}
