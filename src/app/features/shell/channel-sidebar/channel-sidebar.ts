import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { UnreadStore } from '../../../core/stores/unread.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { DmStore } from '../../../core/stores/dm.store';
import { PreferredStatus, toAvatarStatus } from '../../../core/models/presence.models';
import { UiAvatar, UiIconButton } from '../../../shared/ui';
import { delayedSignal } from '../../../shared/util/delayed-signal';

interface StatusOption {
  value: PreferredStatus;
  label: string;
  dotClass: string;
}

@Component({
  selector: 'app-channel-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, UiAvatar, UiIconButton, FormsModule],
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
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly dmStore = inject(DmStore);
  private readonly router = inject(Router);

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

  // Status picker
  protected readonly showStatusMenu = signal(false);
  protected readonly myAvatarStatus = computed(() => toAvatarStatus(this.presenceStore.myStatus()));
  protected readonly statusOptions: StatusOption[] = [
    { value: 'online', label: 'Online', dotClass: 'bg-success' },
    { value: 'away', label: 'Idle', dotClass: 'bg-warning' },
    { value: 'dnd', label: 'Do Not Disturb', dotClass: 'bg-danger' },
    { value: 'invisible', label: 'Invisible', dotClass: 'bg-surface-3' },
  ];

  toggleStatusMenu(): void {
    this.showStatusMenu.update((v) => !v);
  }

  selectStatus(status: PreferredStatus): void {
    this.showStatusMenu.set(false);
    this.presenceStore.setMyStatus(status);
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
