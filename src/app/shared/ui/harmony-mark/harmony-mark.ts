import { Component, input } from '@angular/core';

/**
 * Harmony brand mark — "Resonance". Two overlapping rings whose intersection
 * lights up as a bright lens: two voices meeting in harmony.
 *
 * Two-tone by default: drawn from the live theme tokens (`--color-accent` /
 * `--color-accent-light`), so it re-themes for every palette × mode with no
 * extra wiring — this is the flagship look (auth, splash). In `mono` mode the
 * whole mark follows `currentColor`, so a caller can drive it with `text-*`
 * (e.g. the guild-rail home button that flips to white when active). Purely
 * decorative — always paired with a visible "Harmony" wordmark, hence aria-hidden.
 */
@Component({
  selector: 'harmony-mark',
  standalone: true,
  host: { style: 'display: inline-flex; line-height: 0' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle [attr.cx]="12.5" cy="16" r="7.4" [attr.stroke]="ringColor()" stroke-width="2.3" opacity="0.85" />
      <circle [attr.cx]="19.5" cy="16" r="7.4" [attr.stroke]="ringColor()" stroke-width="2.3" opacity="0.85" />
      <path d="M16 9.48 A7.4 7.4 0 0 1 16 22.52 A7.4 7.4 0 0 1 16 9.48 Z" [attr.fill]="lensColor()" />
    </svg>
  `,
})
export class HarmonyMark {
  /** Rendered edge length in px. */
  size = input<number>(32);
  /** Follow `currentColor` instead of the two-tone accent palette. */
  mono = input<boolean>(false);

  protected ringColor = () => (this.mono() ? 'currentColor' : 'var(--color-accent)');
  protected lensColor = () => (this.mono() ? 'currentColor' : 'var(--color-accent-light)');
}
