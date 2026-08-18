import { Injectable, signal } from '@angular/core';
import { isTauri } from './tauri-env';

/**
 * Launch-on-login for the desktop build. Unlike the localStorage-backed prefs, this state lives in
 * the OS (a registry Run entry / LaunchAgent), so `enabled` is read back from the plugin rather than
 * persisted here. Autostart launches Harmony with `--minimized` (configured in lib.rs), so it starts
 * hidden in the tray. No-op on the web build.
 */
@Injectable({ providedIn: 'root' })
export class AutostartService {
  private readonly _enabled = signal(false);
  readonly enabled = this._enabled.asReadonly();

  constructor() {
    if (isTauri()) void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      this._enabled.set(await isEnabled());
    } catch {
      /* non-fatal — leave as false */
    }
  }

  async set(on: boolean): Promise<void> {
    if (!isTauri()) return;
    this._enabled.set(on); // optimistic
    try {
      const plugin = await import('@tauri-apps/plugin-autostart');
      if (on) await plugin.enable();
      else await plugin.disable();
      this._enabled.set(await plugin.isEnabled()); // reconcile with the real OS state
    } catch {
      void this.refresh();
    }
  }
}
