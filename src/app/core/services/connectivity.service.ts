import { Injectable, Signal, signal } from '@angular/core';

/**
 * Live `online` boolean signal backed by the browser's connectivity events. `win` is a test seam —
 * specs drive `navigator.onLine` + dispatched `online`/`offline` events through a fake window.
 *
 * Note: `navigator.onLine === true` only means a network interface exists, not that the internet is
 * reachable — but a `false` / `offline` event is a reliable "no network at all" signal, which is the
 * case the banner exists to surface. SignalR reconnect + the retry interceptor already handle the
 * flaky-but-connected case; this just gives the user an explicit affordance when the box is offline.
 */
export function onlineSignal(win: Window = window): Signal<boolean> {
  const value = signal(win.navigator.onLine);
  win.addEventListener('online', () => value.set(true));
  win.addEventListener('offline', () => value.set(false));
  return value.asReadonly();
}

@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  /** False when the browser reports no network connection. Drives the shell's offline banner. */
  readonly online = onlineSignal();
}
