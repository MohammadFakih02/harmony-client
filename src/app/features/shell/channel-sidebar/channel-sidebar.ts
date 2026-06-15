import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { UiAvatar } from '../../../shared/ui';

@Component({
  selector: 'app-channel-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, UiAvatar, FormsModule],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './channel-sidebar.html',
  styleUrl: './channel-sidebar.scss',
})
export class ChannelSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly channelStore = inject(ChannelStore);
  protected readonly unreadStore = inject(UnreadStore);
  private readonly router = inject(Router);

  protected readonly showCreateModal = signal(false);
  protected readonly channelName = signal('');
  protected readonly channelType = signal<'text' | 'voice'>('text');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');

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
