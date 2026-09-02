import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Document-title strategy for the whole app.
 *
 * Angular's default TitleStrategy sets `document.title` to a route's `title` verbatim
 * and leaves it at the index.html value when a route declares none — which would mean
 * a browser tab that reads "Sign in" with no hint of which app it belongs to. This
 * suffixes the brand instead, and falls back to the bare brand for routes that have no
 * meaningful static title of their own (a channel or DM, whose name is only known once
 * the data loads).
 */
@Injectable({ providedIn: 'root' })
export class HarmonyTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  static readonly BRAND = 'Harmony';

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    this.title.setTitle(
      routeTitle ? `${routeTitle} • ${HarmonyTitleStrategy.BRAND}` : HarmonyTitleStrategy.BRAND,
    );
  }
}
