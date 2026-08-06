import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Records the previous in-app URL so full-screen overlays (Settings, Server Settings) can return
 * you to exactly where you were instead of a fixed fallback. Must be instantiated at boot — it's
 * injected by ShellComponent so its NavigationEnd subscription is live BEFORE you ever open an
 * overlay (a service only injected by the overlay would start recording too late to know the
 * screen you came from).
 */
@Injectable({ providedIn: 'root' })
export class NavigationHistoryService {
  private previousUrl: string | null = null;
  private currentUrl: string | null = null;

  constructor() {
    const router = inject(Router);
    this.currentUrl = router.url;
    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.previousUrl = this.currentUrl;
      this.currentUrl = e.urlAfterRedirects;
    });
  }

  /**
   * The last URL that did NOT start with `prefix` — i.e. the real screen you were on before entering
   * an overlay routed under `prefix`. Null when there's no such history (e.g. a direct deep-link),
   * so the caller falls back to a sensible default.
   */
  previousOutside(prefix: string): string | null {
    return this.previousUrl && !this.previousUrl.startsWith(prefix) ? this.previousUrl : null;
  }
}
