import { Injectable } from '@angular/core';
import { isTauri } from './tauri-env';

/**
 * Native OS notifications for the desktop (Tauri) build. Raised alongside the in-app toast for the
 * same events (mentions/replies) but only when the window is NOT focused — hidden to the tray,
 * minimized, or in the background — so a focused user gets just the in-app toast and no duplicate.
 * Permission is requested once at boot. Entirely no-op on the web build: @tauri-apps/plugin-notification
 * is only dynamically imported under isTauri().
 */
@Injectable({ providedIn: 'root' })
export class DesktopNotificationService {
  private granted = false;
  private readonly ready: Promise<void> | null;

  constructor() {
    this.ready = isTauri() ? this.ensurePermission() : null;
  }

  private async ensurePermission(): Promise<void> {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        '@tauri-apps/plugin-notification'
      );
      this.granted = await isPermissionGranted();
      if (!this.granted) this.granted = (await requestPermission()) === 'granted';
    } catch {
      this.granted = false;
    }
  }

  /**
   * Show a native notification. Silently returns when on the web build, when the window is focused
   * (the in-app toast already covers it), or when permission was denied.
   */
  async notify(title: string, body: string): Promise<void> {
    if (!isTauri()) return;
    if (typeof document !== 'undefined' && document.hasFocus()) return;
    // Flash the taskbar for attention (Windows, Discord-style) — independent of the notification
    // permission, so a denied notification still grabs attention.
    void this.flashTaskbar();
    if (this.ready) await this.ready;
    if (!this.granted) return;
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title, body: body || undefined });
    } catch {
      /* non-fatal */
    }
  }

  /** Flashes the taskbar button (Windows); clears when the window regains focus. Called from notify(). */
  private async flashTaskbar(): Promise<void> {
    try {
      const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
      await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
    } catch {
      /* non-fatal */
    }
  }
}
