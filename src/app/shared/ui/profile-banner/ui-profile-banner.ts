import { Component, computed, input, linkedSignal } from '@angular/core';
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
    <img
      [src]="url"
      [alt]="alt()"
      class="absolute inset-0 w-full h-full object-cover transition-opacity duration-150"
      [class.opacity-0]="!imageLoaded()"
      (load)="imageLoaded.set(true)"
    />
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
  /** Painted even under an image — the loading flash shows this instead of a transparent hole. */
  protected readonly background = computed(() => this.bannerColor() || this.fallback());
  /** Resets whenever the image URL changes, so a new banner fades in over the colour again. */
  protected readonly imageLoaded = linkedSignal({
    source: this.imageUrl,
    computation: () => false,
  });
}
