import { Injectable, Signal, signal } from '@angular/core';

/**
 * Wraps a media query in a live boolean signal. The `mm` parameter exists as a test seam —
 * jsdom has no real `matchMedia`, so specs pass a fake MediaQueryList factory.
 */
export function mediaQuerySignal(
  query: string,
  mm: (q: string) => MediaQueryList = (q) => window.matchMedia(q),
): Signal<boolean> {
  const mql = mm(query);
  const value = signal(mql.matches);
  mql.addEventListener('change', (e) => value.set(e.matches));
  return value.asReadonly();
}

/**
 * Root viewport signals for the responsive layout. `isMobile` keys off width and matches the
 * Tailwind `md:` boundary exactly, so template `max-md:` classes and behavioral branches flip
 * together. `coarsePointer` keys off input capability (phones AND large tablets) and drives
 * touch affordances — long-press menus, always-visible row actions — independent of width.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  readonly isMobile = mediaQuerySignal('(max-width: 767.98px)');
  readonly coarsePointer = mediaQuerySignal('(pointer: coarse)');
}
