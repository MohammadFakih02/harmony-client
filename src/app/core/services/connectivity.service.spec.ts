import { onlineSignal } from './connectivity.service';

/** Minimal fake Window: settable navigator.onLine + manual online/offline event dispatch. */
function fakeWindow(initialOnline: boolean) {
  const listeners: Record<string, (() => void)[]> = {};
  const win = {
    navigator: { onLine: initialOnline },
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
  } as unknown as Window;
  return { win, fire: (type: 'online' | 'offline') => listeners[type]?.forEach((f) => f()) };
}

describe('onlineSignal', () => {
  it('seeds from navigator.onLine', () => {
    expect(onlineSignal(fakeWindow(true).win)()).toBe(true);
    expect(onlineSignal(fakeWindow(false).win)()).toBe(false);
  });

  it('flips false on offline and true on online', () => {
    const { win, fire } = fakeWindow(true);
    const sig = onlineSignal(win);
    expect(sig()).toBe(true);
    fire('offline');
    expect(sig()).toBe(false);
    fire('online');
    expect(sig()).toBe(true);
  });
});
