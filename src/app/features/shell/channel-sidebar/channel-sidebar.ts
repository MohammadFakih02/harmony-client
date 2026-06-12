import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { UiAvatar } from '../../../shared/ui';

@Component({
  selector: 'app-channel-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, UiAvatar],
  templateUrl: './channel-sidebar.html',
  styleUrl: './channel-sidebar.scss',
})
export class ChannelSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly guildStore = inject(GuildStore);
  protected readonly channelStore = inject(ChannelStore);
  protected readonly unreadStore = inject(UnreadStore);

  toggleCategory(categoryId: number | null): void {
    if (categoryId !== null) this.channelStore.toggleCategory(categoryId);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
