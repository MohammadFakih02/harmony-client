import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification, NotificationActor } from '../../../core/models/notification.models';
import { NotificationStore } from '../../../core/stores/notification.store';
import { UiAvatar, UiIconButton } from '../../../shared/ui';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [UiAvatar, UiIconButton],
  templateUrl: './notification-bell.html',
})
export class NotificationBell {
  protected readonly store = inject(NotificationStore);
  private readonly router = inject(Router);

  protected readonly showPanel = signal(false);

  constructor() {
    // Lazily resolve actor identity (username/avatar) for any notification we haven't seen yet.
    effect(() => {
      for (const n of this.store.notifications()) {
        if (!this.store.actors()[n.actorId]) this.store.resolveActor(n.actorId);
      }
    });
  }

  togglePanel(): void {
    this.showPanel.update((v) => !v);
  }

  closePanel(): void {
    this.showPanel.set(false);
  }

  actorOf(n: AppNotification): NotificationActor | undefined {
    return this.store.actors()[n.actorId];
  }

  message(n: AppNotification): string {
    const username = this.actorOf(n)?.username ?? '…';
    switch (n.type) {
      case 'mention':
        return `${username} mentioned you`;
      case 'friend_request':
        return `${username} sent you a friend request`;
      default:
        return `${username} sent you a notification`;
    }
  }

  timeAgo(ms: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  async open(n: AppNotification): Promise<void> {
    this.closePanel();
    this.store.markRead(n.id);
    if (n.type === 'mention' && n.channelId) {
      const route = n.guildId
        ? ['/app/guilds', n.guildId, 'channels', n.channelId]
        : ['/app/dm', n.channelId];
      await this.router.navigate(route);
    } else if (n.type === 'friend_request') {
      await this.router.navigate(['/app/friends']);
    }
  }

  markAllRead(): void {
    this.store.markAllRead();
  }
}
