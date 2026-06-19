import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { UnreadStore } from '../../../core/stores/unread.store';

@Component({
  selector: 'app-guild-sidebar',
  standalone: true,
  imports: [RouterLink, FormsModule],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './guild-sidebar.html',
  styleUrl: './guild-sidebar.scss',
})
export class GuildSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly unreadStore = inject(UnreadStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly router = inject(Router);

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

  navigateToGuild(guildId: string): void {
    // Already viewing this guild → do nothing (re-navigating would blank the open
    // channel). Check the URL, not selectedGuildId (which stays stale on /friends).
    // The trailing-boundary check avoids snowflake-id prefix collisions.
    const url = this.router.url;
    if (url.includes(`/guilds/${guildId}/`) || url.endsWith(`/guilds/${guildId}`)) return;
    this.router.navigate(['/app/guilds', guildId]);
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
      // Create a default text channel, then navigate into it
      const general = await this.channelStore.createChannel(guild.id, 'general', 'text');
      this.showCreateModal.set(false);
      this.router.navigate(['/app/guilds', guild.id, 'channels', general.id]);
    } catch {
      this.error.set('Failed to create server. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}
