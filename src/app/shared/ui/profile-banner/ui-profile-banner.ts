import { Component, computed, input } from '@angular/core';
import { publicFileUrl } from '../../util/public-file-url';

/** Accent-gradient fallback — the same recipe as the `.profile-banner` CSS class / role gradients. */
export function bannerGradient(color?: string | null): string {
  const c = color ?? 'var(--color-accent)';
  return `linear-gradient(135deg, ${c} 0%, color-mix(in srgb, ${c} 55%, #000) 100%)`;
}

/**
 * Profile banner — the one shared implementation of "image > picked colour > gradient fallback"
 * used by every profile surface (popout, full-profile modal, DM peer panel, settings). The host
 * is the sized container: give it a height class (`class="h-28"`); projected content (close
 * buttons, edit overlays) renders above the image.
 */
@Component({
  selector: 'ui-profile-banner',
  standalone: true,
  host: {
    class: 'block relative overflow-hidden',
    '[style.background]': 'background()',
  },
  template: `
    @if (imageUrl(); as url) {
    <img [src]="url" [alt]="alt()" class="absolute inset-0 w-full h-full object-cover" />
    }
    <ng-content />
  `,
})
export class UiProfileBanner {
  /** Storage key (banners/…) or absolute URL of the banner image. */
  readonly bannerKey = input<string | null>(null);
  /** User-picked banner colour ("#rrggbb") — used when there's no image. */
  readonly bannerColor = input<string | null>(null);
  /** CSS background when neither image nor colour is set (defaults to the accent gradient). */
  readonly fallback = input<string>(bannerGradient());
  readonly alt = input('');

  protected readonly imageUrl = computed(() => publicFileUrl(this.bannerKey()));
  protected readonly background = computed(() =>
    this.bannerKey() ? null : this.bannerColor() || this.fallback(),
  );
}
