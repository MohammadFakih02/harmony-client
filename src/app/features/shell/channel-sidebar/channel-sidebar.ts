import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { UiAvatar } from '../../../shared/ui';

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
}

interface Category {
  id: string;
  name: string;
  channels: Channel[];
  collapsed: boolean;
}

@Component({
  selector: 'app-channel-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, UiAvatar],
  templateUrl: './channel-sidebar.html',
  styleUrl: './channel-sidebar.scss',
})
export class ChannelSidebar {
  auth = inject(AuthService);
  theme = inject(ThemeService);

  guildName = signal('My Server');

  // Placeholder — replaced by NgRx store in Month 2
  categories = signal<Category[]>([
    {
      id: '1',
      name: 'Text Channels',
      collapsed: false,
      channels: [
        { id: '1', name: 'general', type: 'text' },
        { id: '2', name: 'announcements', type: 'text' },
        { id: '3', name: 'off-topic', type: 'text' },
      ],
    },
    {
      id: '2',
      name: 'Voice Channels',
      collapsed: false,
      channels: [
        { id: '4', name: 'General', type: 'voice' },
        { id: '5', name: 'Gaming', type: 'voice' },
      ],
    },
  ]);

  toggleCategory(categoryId: string): void {
    this.categories.update(cats =>
      cats.map(c => c.id === categoryId ? { ...c, collapsed: !c.collapsed } : c)
    );
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
