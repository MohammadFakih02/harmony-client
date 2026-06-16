import { Signal, effect, signal } from '@angular/core';

/**
 * Wraps a boolean "loading" signal so it only reports `true` after the source
 * has stayed truthy for `delayMs`. Fast operations that finish before the delay
 * never flip it, eliminating the spinner "flash" on sub-second loads.
 *
 * Must be called in an injection context (e.g. a component field initializer).
 */
export function delayedSignal(source: Signal<boolean>, delayMs = 200): Signal<boolean> {
  const visible = signal(false);

  effect((onCleanup) => {
    if (!source()) {
      visible.set(false);
      return;
    }
    const timer = setTimeout(() => visible.set(true), delayMs);
    onCleanup(() => clearTimeout(timer));
  });

  return visible.asReadonly();
}
