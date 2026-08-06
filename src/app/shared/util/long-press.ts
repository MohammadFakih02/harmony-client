/**
 * Pure long-press state machine (no DOM, no timers) — the touch counterpart to a right-click.
 * The caller owns the actual timer: `begin` on pointerdown (returns whether a timer should be
 * scheduled), feed `move` events, `cancel` on pointerup/pointercancel, and when the timer fires
 * call `tryFire` — it returns the press origin if the gesture is still eligible, else null
 * (the pointer lifted, moved past the slop, or a second finger joined).
 */

export interface LongPressConfig {
  /** How long the pointer must stay down before the press fires. */
  delayMs: number;
  /** Movement tolerance — beyond this the gesture is a scroll/drag, not a press. */
  slopPx: number;
}

export const LONG_PRESS_DEFAULTS: LongPressConfig = { delayMs: 500, slopPx: 10 };

export interface LongPressTracker {
  /** Start tracking a pointer. Returns false (and cancels) if a press is already active — a second finger aborts the gesture. */
  begin(pointerId: number, x: number, y: number): boolean;
  /** Feed pointer movement; silently cancels once the pointer strays past the slop. */
  move(pointerId: number, x: number, y: number): void;
  /** Abort the gesture (pointerup, pointercancel, native contextmenu seen). */
  cancel(): void;
  /** Called when the caller's timer fires: the press origin if still eligible, else null. Consumes the press. */
  tryFire(): { x: number; y: number } | null;
}

export function createLongPressTracker(cfg: LongPressConfig = LONG_PRESS_DEFAULTS): LongPressTracker {
  let press: { pointerId: number; x: number; y: number } | null = null;

  return {
    begin(pointerId, x, y) {
      if (press) {
        press = null;
        return false;
      }
      press = { pointerId, x, y };
      return true;
    },
    move(pointerId, x, y) {
      if (!press || pointerId !== press.pointerId) return;
      if (Math.hypot(x - press.x, y - press.y) > cfg.slopPx) press = null;
    },
    cancel() {
      press = null;
    },
    tryFire() {
      if (!press) return null;
      const at = { x: press.x, y: press.y };
      press = null;
      return at;
    },
  };
}
