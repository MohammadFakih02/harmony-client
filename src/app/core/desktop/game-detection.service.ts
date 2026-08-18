import { Injectable, effect, inject } from '@angular/core';
import { isTauri, tauriInvoke } from './tauri-env';
import { DesktopSettingsService } from './desktop-settings.service';
import { PresenceStore } from '../stores/presence.store';

const POLL_MS = 45_000;
const GAME_PREFIX = '\u{1F3AE} Playing '; // 🎮 Playing

/**
 * "Playing X" rich presence for the desktop build. When enabled (Desktop settings), it polls the
 * Rust `detected_game` command and reflects the running game into the user's custom status via the
 * EXISTING presence pipeline — so friends see it live with no backend change. It only touches the
 * custom status while a game is running: it snapshots whatever was set beforehand and restores it
 * when the game closes (or the feature is turned off), and never overwrites a status the user
 * changed by hand mid-game. No-op on the web build.
 */
@Injectable({ providedIn: 'root' })
export class GameDetectionService {
  private readonly settings = inject(DesktopSettingsService);
  private readonly presence = inject(PresenceStore);

  private timer: ReturnType<typeof setInterval> | null = null;
  private advertising = false; // whether we're currently showing a "Playing …" status
  private savedStatus: string | null = null; // the user's custom status from before the game started

  constructor() {
    if (!isTauri()) return;
    effect(() => {
      const enabled = this.settings.gameActivity();
      // Defer the actual work so presence reads/writes never happen inside the effect's tracked
      // execution (which would make it depend on the status it edits). The flag is the only dep.
      queueMicrotask(() => (enabled ? this.start() : this.stop()));
    });
  }

  private start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearGame();
  }

  private async tick(): Promise<void> {
    const game = await this.detect();
    const current = this.presence.myStatusMessage();

    if (game) {
      const label = GAME_PREFIX + game;
      if (!this.advertising) {
        // Starting to advertise a game — remember the user's own status (ignore a stale game label).
        this.savedStatus = current && !current.startsWith(GAME_PREFIX) ? current : null;
      }
      if (current !== label) void this.presence.setCustomStatus(label);
      this.advertising = true;
    } else if (this.advertising) {
      this.clearGame();
    }
  }

  /** Game closed / feature disabled: restore the pre-game status, but only if ours is still showing. */
  private clearGame(): void {
    if (!this.advertising) return;
    const current = this.presence.myStatusMessage();
    this.advertising = false;
    if (current && current.startsWith(GAME_PREFIX)) {
      void this.presence.setCustomStatus(this.savedStatus);
    }
    this.savedStatus = null;
  }

  private async detect(): Promise<string | null> {
    return (await tauriInvoke<string | null>('detected_game')) ?? null;
  }
}
