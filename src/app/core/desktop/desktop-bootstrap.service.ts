import { Injectable, inject } from '@angular/core';
import { isTauri } from './tauri-env';
import { DesktopSettingsService } from './desktop-settings.service';
import { DesktopBadgeService } from './desktop-badge.service';
import { GlobalShortcutsService } from './global-shortcuts.service';
import { GameDetectionService } from './game-detection.service';

/**
 * Single boot seam for the desktop (Tauri) subsystems. Instantiating the boot-time desktop services
 * (settings→Rust sync, unread badge, global hotkeys, game-activity presence) is centralized here
 * behind ONE isTauri() check. On the web build it returns before injecting anything, so none of those
 * services — nor the root stores they pull in (Voice/Presence/Notification/Unread) — are constructed
 * at web boot. Injected once in App; adding a boot-time desktop feature means touching only this file.
 */
@Injectable({ providedIn: 'root' })
export class DesktopBootstrapService {
  constructor() {
    if (!isTauri()) return;
    inject(DesktopSettingsService);
    inject(DesktopBadgeService);
    inject(GlobalShortcutsService);
    inject(GameDetectionService);
  }
}
