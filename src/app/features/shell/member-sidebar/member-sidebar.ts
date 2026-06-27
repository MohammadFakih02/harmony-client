import { Component, inject, effect, computed, signal, OnDestroy } from '@angular/core';
import { CdkOverlayOrigin, ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { UiAvatar } from '../../../shared/ui';
import { GuildStore } from '../../../core/stores/guild.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { MemberStore } from '../../../core/stores/member.store';
import { AuthService } from '../../../core/services/auth.service';
import { GuildMember } from '../../../core/models/member.models';
import { toAvatarStatus } from '../../../core/models/presence.models';
import { MemberActionsMenu } from './member-actions-menu';
import { BansModal } from './bans-modal';

@Component({
  selector: 'app-member-sidebar',
  standalone: true,
  imports: [UiAvatar, OverlayModule, MemberActionsMenu, BansModal],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './member-sidebar.html',
})
export class MemberSidebar implements OnDestroy {
  protected readonly guildStore = inject(GuildStore);
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly memberStore = inject(MemberStore);
  private readonly auth = inject(AuthService);

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

  protected readonly caps = computed(() => {
    const guildId = this.guildStore.selectedGuildId();
    return guildId ? this.memberStore.capabilitiesOf(guildId) : null;
  });

  /** Whether the caller can run any member action (moderation or role assignment) — drives the row menu. */
  protected readonly canModerateAny = computed(() => {
    const c = this.caps();
    return !!c && (c.canKick || c.canBan || c.canTimeout || c.canManageRoles);
  });

  protected readonly sortedMembers = computed(() =>
    [...this.members()].sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return this.displayName(a).localeCompare(this.displayName(b));
    }),
  );

  // Bake each member's avatar status into a computed so the view tracks the `statuses`
  // signal directly. Reading it through a per-row method binding wasn't re-rendering on a
  // live status change (e.g. the current user changing their own status) until the panel
  // was reopened — this guarantees a re-render whenever any status changes.
  protected readonly rows = computed(() => {
    const statuses = this.presenceStore.statuses();
    const messages = this.presenceStore.statusMessages();
    const now = this.now();
    return this.sortedMembers().map((member) => ({
      member,
      status: toAvatarStatus(statuses[member.userId] ?? 'offline'),
      statusMessage: messages[member.userId] ?? null,
      timedOut:
        member.communicationDisabledUntil != null && member.communicationDisabledUntil > now,
      moderatable: this.canModerate(member),
    }));
  });

  // --- moderation action menu (CDK overlay anchored to the clicked row) ---
  protected readonly menuMember = signal<GuildMember | null>(null);
  protected readonly menuOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly showBans = signal(false);
  protected readonly menuPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
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
  }

  ngOnDestroy(): void {
    clearInterval(this.ticker);
  }

  /** A member is moderatable if the caller has a mod cap and the target isn't themselves or the owner. */
  protected canModerate(m: GuildMember): boolean {
    return this.canModerateAny() && !m.isOwner && m.userId !== this.auth.currentUser()?.id;
  }

  protected openMenu(member: GuildMember, origin: CdkOverlayOrigin): void {
    this.menuOrigin.set(origin);
    this.menuMember.set(member);
  }

  protected closeMenu(): void {
    this.menuMember.set(null);
    this.menuOrigin.set(null);
  }

  protected displayName(m: GuildMember): string {
    return m.nickname ?? m.username;
  }
}
