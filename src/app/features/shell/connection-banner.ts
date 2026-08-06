import { Component, effect, inject, signal } from '@angular/core';
import { SignalRService } from '../../core/services/signalr.service';

/**
 * App-wide connection banner (floating top-center pill): amber while SignalR auto-reconnects, red
 * once retries fall back to the background 5s loop (with a manual Retry for immediacy), and a brief
 * green "Reconnected" flash when the socket comes back after an outage. Purely presentational —
 * reconnection itself is SignalRService's job (it never stops retrying on its own). Sends keep
 * working while offline via the REST fallback, hence "live updates paused" rather than "offline".
 */
@Component({
  selector: 'app-connection-banner',
  standalone: true,
  template: `
    @let state = signalR.connectionState();
    @if (state === 'reconnecting') {
    <div
      class="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-warning text-bg text-sm font-medium shadow-modal animate-slide-down"
      role="status"
    >
      <i class="fas fa-yin-yang animate-spin text-xs"></i>
      <span>Connection lost — reconnecting…</span>
    </div>
    } @else if (state === 'disconnected') {
    <div
      class="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-danger text-white text-sm font-medium shadow-modal animate-slide-down"
      role="status"
    >
      <i class="fas fa-wifi text-xs"></i>
      <span>No connection — live updates paused</span>
      <button
        type="button"
        class="ml-1 px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-xs font-semibold transition-micro disabled:opacity-60"
        [disabled]="retrying()"
        (click)="retry()"
      >
        @if (retrying()) {
        <i class="fas fa-yin-yang animate-spin"></i>
        } @else {
        Retry now
        }
      </button>
    </div>
    } @else if (justReconnected()) {
    <div
      class="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-success text-white text-sm font-medium shadow-modal animate-slide-down"
      role="status"
    >
      <i class="fas fa-check text-xs"></i>
      <span>Reconnected</span>
    </div>
    }
  `,
})
export class ConnectionBanner {
  protected readonly signalR = inject(SignalRService);
  protected readonly retrying = signal(false);
  protected readonly justReconnected = signal(false);

  constructor() {
    // Flash "Reconnected" only on a recovery (down → connected), never on the initial connect.
    let wasDown = false;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const state = this.signalR.connectionState();
      if (state === 'reconnecting' || state === 'disconnected') {
        wasDown = true;
        this.justReconnected.set(false);
        if (flashTimer) {
          clearTimeout(flashTimer);
          flashTimer = null;
        }
      } else if (state === 'connected' && wasDown) {
        wasDown = false;
        this.justReconnected.set(true);
        flashTimer = setTimeout(() => this.justReconnected.set(false), 2500);
      }
    });
  }

  /** Kick an immediate connect attempt instead of waiting out the background 5s retry. */
  protected retry(): void {
    if (this.retrying()) return;
    this.retrying.set(true);
    void this.signalR
      .connect()
      .catch(() => {})
      .finally(() => this.retrying.set(false));
  }
}
