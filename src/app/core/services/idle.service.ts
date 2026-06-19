import { Injectable, NgZone, inject } from '@angular/core';
import { HarmonyHubClient } from '../hub/harmony-hub.client';

/** Inactivity threshold before the user is reported idle (auto-away). */
const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Detects user inactivity and reports it to the server via the hub so presence can
 * flip online ↔ away. Only the client knows about real input activity — heartbeats
 * fire on a fixed timer regardless — so auto-away has to originate here.
 *
 * Runs its timer/listeners outside Angular's zone to avoid triggering change
 * detection on every mouse move; the hub invokes are fire-and-forget.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly zone = inject(NgZone);

  private client: HarmonyHubClient | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idle = false;
  private readonly onActivity = () => this.handleActivity();
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.handleActivity();
  };

  start(client: HarmonyHubClient): void {
    this.stop();
    this.client = client;
    this.zone.runOutsideAngular(() => {
      for (const evt of ACTIVITY_EVENTS) {
        window.addEventListener(evt, this.onActivity, { passive: true });
      }
      document.addEventListener('visibilitychange', this.onVisibility);
      this.armTimer();
    });
  }

  stop(): void {
    for (const evt of ACTIVITY_EVENTS) {
      window.removeEventListener(evt, this.onActivity);
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client = null;
    this.idle = false;
  }

  private handleActivity(): void {
    if (this.idle) {
      this.idle = false;
      this.client?.setIdle(false).catch(() => {});
    }
    this.armTimer();
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.idle = true;
      this.client?.setIdle(true).catch(() => {});
    }, IDLE_THRESHOLD_MS);
  }
}
