import { Injectable, inject } from '@angular/core';
import { isTauri } from './tauri-env';
import { VoiceStore } from '../stores/voice.store';

/**
 * System-wide voice hotkeys for the desktop build — they fire even when Harmony is unfocused or
 * hidden to the tray, so you can mute/deafen mid-game without alt-tabbing (the classic Discord
 * desktop feature). Fixed bindings for v1 (Ctrl+Shift+M / Ctrl+Shift+D). The VoiceStore toggles are
 * no-ops when you're not in a voice channel, and zone-safe (the app is zoneless). No-op on web.
 */
@Injectable({ providedIn: 'root' })
export class GlobalShortcutsService {
  private readonly voice = inject(VoiceStore);

  constructor() {
    if (isTauri()) void this.registerAll();
  }

  private async registerAll(): Promise<void> {
    const mod = await import('@tauri-apps/plugin-global-shortcut').catch(() => null);
    if (!mod) return;
    // Register each independently (so one already-held combo doesn't block the other) and concurrently.
    // Only act on key-down (the callback also fires on release).
    await Promise.all([
      this.bind(mod, 'CmdOrCtrl+Shift+M', () => this.voice.toggleMute()),
      this.bind(mod, 'CmdOrCtrl+Shift+D', () => this.voice.toggleDeafen()),
    ]);
  }

  private async bind(
    mod: typeof import('@tauri-apps/plugin-global-shortcut'),
    accelerator: string,
    action: () => void,
  ): Promise<void> {
    try {
      // Clear any stale registration (e.g. from a prior dev hot-reload) before re-binding.
      if (await mod.isRegistered(accelerator)) await mod.unregister(accelerator);
      await mod.register(accelerator, (e) => {
        if (e.state === 'Pressed') action();
      });
    } catch {
      /* a combo held by another app is non-fatal — just skip it */
    }
  }
}
