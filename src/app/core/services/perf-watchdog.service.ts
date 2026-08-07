import { Injectable, isDevMode } from '@angular/core';

/** Threshold above which a main-thread task is flagged — the dropped-frame / INP jank boundary. */
const LONG_TASK_MS = 50;
/**
 * A gap between animation frames beyond this = the main thread was blocked long enough to drop frames.
 * ~50ms ≈ 3 missed frames. This is the cross-browser signal (the `longtask` observer is Chromium-only).
 * The upper bound filters out tab-backgrounding / GC pauses, which aren't UI jank.
 */
const FRAME_STALL_MS = 50;
const FRAME_STALL_MAX_MS = 2000;
/** Summaries are emitted at most once per this window — one line/sec, never a per-event flood. */
const FLUSH_MS = 1000;

/**
 * Dev-only main-thread jank watchdog (Track A8 seed — and the measurement tool the risky A5 rendering
 * work depends on). It answers, from numbers rather than guesswork, where the felt jank is: does an
 * action produce a stall, how big, and — crucially — is it a one-shot burst or a *continuous* re-render
 * storm (jank every second forever = a feedback loop; jank then silence = a one-time burst).
 *
 * Two signals, because no single API is both precise and cross-browser:
 *   • `longtask` PerformanceObserver — precise, but **Chromium-only** (feature-detected; silent elsewhere).
 *   • a `requestAnimationFrame` frame-gap monitor — works **everywhere**; a gap ≥50ms means the main
 *     thread was blocked long enough to drop frames.
 *
 * Both are **coalesced into a once-per-second summary** so a storm can never flood the console (which
 * would itself distort the measurement, especially with the React-DevTools console hook installed).
 *
 * Guarded to development: `isDevMode()` is false in a production build, so `start()` no-ops and neither
 * signal runs. Correlate a stall with a specific action via `mark(label)` (a `performance.mark`).
 */
@Injectable({ providedIn: 'root' })
export class PerfWatchdogService {
  private observer: PerformanceObserver | null = null;
  private rafId: number | null = null;
  private lastFrameAt = 0;
  private started = false;

  // Rolling one-second buckets.
  private windowStart = 0;
  private longCount = 0;
  private longMax = 0;
  private longTotal = 0;
  private stallCount = 0;
  private stallMax = 0;

  /** Begin watching for main-thread jank. Idempotent; dev-only. Call once at app boot. */
  start(): void {
    if (this.started || !isDevMode()) return;
    this.started = true;
    this.observeLongTasks();
    this.monitorFrames();
  }

  /** Chromium-only precise signal: every task ≥50ms is bucketed (duration + count). */
  private observeLongTasks(): void {
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask');
    if (!supported) return; // Firefox/Safari — the frame monitor covers them.
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONG_TASK_MS) {
            this.longCount++;
            this.longTotal += entry.duration;
            this.longMax = Math.max(this.longMax, entry.duration);
          }
        }
      });
      this.observer.observe({ type: 'longtask', buffered: true });
    } catch {
      /* observe failed — the frame monitor still runs */
    }
  }

  /** Cross-browser signal: a frame gap ≥50ms means the main thread stalled. Flushes a summary/sec. */
  private monitorFrames(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    const tick = (now: number): void => {
      if (this.lastFrameAt) {
        const gap = now - this.lastFrameAt;
        if (gap >= FRAME_STALL_MS && gap <= FRAME_STALL_MAX_MS && !document.hidden) {
          this.stallCount++;
          this.stallMax = Math.max(this.stallMax, gap);
        }
      }
      this.lastFrameAt = now;
      if (!this.windowStart) this.windowStart = now;
      if (now - this.windowStart >= FLUSH_MS) {
        this.flush(now - this.windowStart);
        this.windowStart = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Emit at most one summary per window, only when there was jank. Resets the buckets. */
  private flush(windowMs: number): void {
    if (this.longCount || this.stallCount) {
      const busy = Math.round((this.longTotal / windowMs) * 100);
      const parts: string[] = [];
      if (this.longCount) {
        parts.push(
          `${this.longCount} long tasks (max ${Math.round(this.longMax)}ms, ~${busy}% busy)`,
        );
      }
      if (this.stallCount) parts.push(`${this.stallCount} stalls (max ${Math.round(this.stallMax)}ms)`);
      // eslint-disable-next-line no-console
      console.warn(`[perf] last ${Math.round(windowMs)}ms: ${parts.join(', ')}`);
    }
    this.longCount = this.longMax = this.longTotal = 0;
    this.stallCount = this.stallMax = 0;
  }

  /** Dev-only: drop a named marker to line up against the jank log (e.g. 'channel-open'). */
  mark(label: string): void {
    if (!isDevMode()) return;
    try {
      performance.mark(label);
    } catch {
      /* performance.mark unavailable — ignore */
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.started = false;
  }
}
