import { Injectable, effect, inject } from '@angular/core';
import { isTauri, tauriInvoke } from './tauri-env';
import { NotificationStore } from '../stores/notification.store';
import { UnreadStore } from '../stores/unread.store';

/**
 * Mirrors the app's total unread into the OS chrome on the desktop (Tauri) build — the tray tooltip
 * and, on Windows, a red taskbar overlay dot. The badge count = bell notifications (mentions/replies/
 * requests/invites) + unread DM messages, matching Discord's red-pill semantics (guild channel
 * unreads show a white dot, not a red badge, so they're intentionally excluded). No-op on web:
 * @tauri-apps/api is only dynamically imported under isTauri().
 */
@Injectable({ providedIn: 'root' })
export class DesktopBadgeService {
  private readonly notifications = inject(NotificationStore);
  private readonly unread = inject(UnreadStore);
  private last = -1;

  constructor() {
    if (!isTauri()) return;
    effect(() => {
      const count = this.notifications.unreadCount() + this.unread.dmUnreadCount();
      if (count === this.last) return;
      this.last = count;
      void tauriInvoke('set_unread', { count });
    });
  }
}
