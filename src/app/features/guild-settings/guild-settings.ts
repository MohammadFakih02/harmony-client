import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Channel } from '../../core/models/channel.models';
import { ChannelService } from '../../core/services/channel.service';
import { GuildStore } from '../../core/stores/guild.store';
import { MemberStore } from '../../core/stores/member.store';
import { GuildOverview } from './pages/guild-overview';
import { GuildWelcome } from './pages/guild-welcome';
import { GuildRoles } from './pages/guild-roles';
import { GuildBans } from './pages/guild-bans';
import { GuildAuditLog } from './pages/guild-audit-log';
import { GuildTrash } from './pages/guild-trash';
import { ViewportService } from '../../core/services/viewport.service';

type Tab = 'overview' | 'welcome' | 'roles' | 'bans' | 'audit' | 'trash';

/**
 * Full-screen guild settings overlay (route `guilds/:guildId/settings`), mirroring the user-settings
 * shell — admin-only config: Overview/Welcome need ManageGuild, Roles needs ManageRoles, Bans needs
 * BanMembers, Audit Log needs ViewAuditLog — each hidden otherwise. Personal notification prefs live
 * in the server dropdown now, NOT here, so a member with no admin panes is bounced out on open.
 * Esc / ✕ returns to the previous screen. (The admin panes here consolidate the old header modals.)
 */
@Component({
  selector: 'app-guild-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GuildOverview, GuildWelcome, GuildRoles, GuildBans, GuildAuditLog, GuildTrash],
  templateUrl: './guild-settings.html',
})
export class GuildSettings implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly channelService = inject(ChannelService);
  private readonly guildStore = inject(GuildStore);
  private readonly memberStore = inject(MemberStore);

  protected readonly guildId = this.route.snapshot.paramMap.get('guildId')!;
  protected readonly textChannels = signal<Channel[]>([]);
  protected readonly activeTab = signal<Tab>('overview');

  // Mobile stacked flow: nav list first, pane on tab pick. Only drives `max-md:` classes.
  private readonly viewport = inject(ViewportService);
  protected readonly showPane = signal(!this.viewport.isMobile());

  protected selectTab(tab: Tab): void {
    this.activeTab.set(tab);
    this.showPane.set(true);
  }

  protected backToNav(): void {
    this.showPane.set(false);
  }

  protected readonly guildName = computed(
    () => this.guildStore.guilds().find((g) => g.id === this.guildId)?.name ?? 'Server',
  );
  protected readonly canManageGuild = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canManageGuild,
  );
  protected readonly canManageRoles = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canManageRoles,
  );
  protected readonly canBan = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canBan,
  );
  protected readonly canViewAuditLog = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canViewAuditLog,
  );
  protected readonly canManageChannels = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canManageChannels,
  );

  async ngOnInit(): Promise<void> {
    if (!this.guildStore.guilds().some((g) => g.id === this.guildId)) {
      await this.guildStore.loadGuilds();
    }
    await Promise.all([
      this.memberStore.loadCapabilitiesIfNeeded(this.guildId),
      this.loadChannels(),
    ]);

    // Personal notification prefs left this page (they're in the server dropdown now), so a member
    // with no admin pane has nothing here — bounce out. Otherwise land on their first available tab.
    const first = this.firstAccessibleTab();
    if (first === null) this.close();
    else this.activeTab.set(first);
  }

  /** The highest-priority settings tab the caller can actually open, or null if they have none. */
  private firstAccessibleTab(): Tab | null {
    if (this.canManageGuild()) return 'overview';
    if (this.canManageRoles()) return 'roles';
    if (this.canBan()) return 'bans';
    if (this.canViewAuditLog()) return 'audit';
    if (this.canManageChannels()) return 'trash';
    return null;
  }

  private async loadChannels(): Promise<void> {
    try {
      const channels = await this.channelService.getGuildChannels(this.guildId);
      this.textChannels.set(
        channels
          .filter((c) => c.type === 'text' || c.type === 'announcement')
          .sort((a, b) => a.position - b.position),
      );
    } catch {
      // leave empty — the panes degrade to no channel rows
    }
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    const before = this.router.url;
    this.location.back();
    setTimeout(() => {
      if (this.router.url === before) void this.router.navigate(['/app/guilds', this.guildId]);
    }, 0);
  }
}
