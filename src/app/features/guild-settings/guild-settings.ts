import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Channel } from '../../core/models/channel.models';
import { ChannelService } from '../../core/services/channel.service';
import { GuildStore } from '../../core/stores/guild.store';
import { MemberStore } from '../../core/stores/member.store';
import { GuildNotificationSettingsStore } from '../../core/stores/guild-notification-settings.store';
import { GuildNotifications } from './pages/guild-notifications';
import { GuildOverview } from './pages/guild-overview';
import { GuildWelcome } from './pages/guild-welcome';

type Tab = 'notifications' | 'overview' | 'welcome';

/**
 * Full-screen guild settings overlay (route `guilds/:guildId/settings`), mirroring the user-settings
 * shell. The Notifications pane is a personal preference open to every member; Overview + Welcome are
 * admin-only (ManageGuild) and hidden otherwise. Esc / ✕ returns to the previous screen.
 */
@Component({
  selector: 'app-guild-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GuildNotifications, GuildOverview, GuildWelcome],
  templateUrl: './guild-settings.html',
})
export class GuildSettings implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly channelService = inject(ChannelService);
  private readonly guildStore = inject(GuildStore);
  private readonly memberStore = inject(MemberStore);
  private readonly notificationSettings = inject(GuildNotificationSettingsStore);

  protected readonly guildId = this.route.snapshot.paramMap.get('guildId')!;
  protected readonly textChannels = signal<Channel[]>([]);
  protected readonly activeTab = signal<Tab>('notifications');

  protected readonly guildName = computed(
    () => this.guildStore.guilds().find((g) => g.id === this.guildId)?.name ?? 'Server',
  );
  protected readonly canManageGuild = computed(
    () => !!this.memberStore.capabilitiesOf(this.guildId)?.canManageGuild,
  );

  async ngOnInit(): Promise<void> {
    if (!this.guildStore.guilds().some((g) => g.id === this.guildId)) {
      await this.guildStore.loadGuilds();
    }
    await Promise.all([
      this.memberStore.loadCapabilitiesIfNeeded(this.guildId),
      this.notificationSettings.load(this.guildId),
      this.loadChannels(),
    ]);
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
