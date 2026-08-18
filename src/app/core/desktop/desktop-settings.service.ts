import { Injectable, signal } from '@angular/core';
import { isTauri, tauriInvoke } from './tauri-env';

const CLOSE_TO_TRAY_KEY = 'harmony.desktop.closeToTray';
const GAME_ACTIVITY_KEY = 'harmony.desktop.gameActivity';

/**
 * Desktop (Tauri) app preferences that must be mirrored into the Rust core. Currently just
 * "close to tray" — whether clicking the window's X hides Harmony to the system tray (default)
 * or quits it. The choice is persisted in localStorage and pushed to Rust both at boot (so the
 * window-close handler matches the saved preference before Settings is ever opened) and on every
 * toggle. A no-op on the web build — @tauri-apps/api is only dynamically imported under isTauri().
 */
@Injectable({ providedIn: 'root' })
export class DesktopSettingsService {
  private readonly _closeToTray = signal(this.readStored(CLOSE_TO_TRAY_KEY, true));
  readonly closeToTray = this._closeToTray.asReadonly();

  // "Display current game as your status" (Playing X). Default OFF — opt-in, drives GameDetectionService.
  private readonly _gameActivity = signal(this.readStored(GAME_ACTIVITY_KEY, false));
  readonly gameActivity = this._gameActivity.asReadonly();

  constructor() {
    // Push the persisted choice into the Rust core at boot (its default is "hide to tray",
    // so this only matters when the user previously turned it off).
    if (isTauri()) void this.sync(this._closeToTray());
  }

  setCloseToTray(enabled: boolean): void {
    this._closeToTray.set(enabled);
    this.persist(CLOSE_TO_TRAY_KEY, enabled);
    void this.sync(enabled);
  }

  setGameActivity(enabled: boolean): void {
    this._gameActivity.set(enabled);
    this.persist(GAME_ACTIVITY_KEY, enabled);
  }

  private persist(key: string, enabled: boolean): void {
    try {
      localStorage.setItem(key, enabled ? '1' : '0');
    } catch {
      /* storage unavailable — the in-memory signal still applies */
    }
  }

  private readStored(key: string, fallback: boolean): boolean {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === '1';
    } catch {
      return fallback;
    }
  }

  private async sync(enabled: boolean): Promise<void> {
    // Non-fatal on failure: the Rust default (hide to tray) still applies.
    await tauriInvoke('set_close_to_tray', { enabled });
  }
}
