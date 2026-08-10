import { Component } from '@angular/core';
import { HarmonyMark } from '../../../shared/ui';

/**
 * Shared chrome for every auth screen: an editorial split layout with a living
 * brand panel (lg+) beside the form column. Screens project their heading + body
 * via <ng-content>. All motion is decorative and collapses under reduced-motion
 * (both the OS media query and the app's `html.reduce-motion` setting class).
 */
@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [HarmonyMark],
  templateUrl: './auth-shell.html',
  styles: [
    `
      :host {
        display: block;
      }

      /* Layered accent world behind the brand panel — reads well in every palette
         because it is built from color-mix() over the live theme tokens. */
      .auth-brand-bg {
        background:
          radial-gradient(
            125% 125% at 12% 8%,
            color-mix(in srgb, var(--color-accent) 24%, transparent),
            transparent 55%
          ),
          radial-gradient(
            100% 100% at 88% 92%,
            color-mix(in srgb, var(--color-accent-light) 18%, transparent),
            transparent 52%
          ),
          linear-gradient(158deg, var(--color-surface), var(--color-bg));
      }

      /* Hairline where the two panels meet — light catching the material edge. */
      .auth-seam {
        box-shadow: 1px 0 0 var(--color-border-subtle);
      }

      .auth-orb {
        position: absolute;
        border-radius: 9999px;
        filter: blur(64px);
        pointer-events: none;
      }
      .auth-orb-1 {
        width: 22rem;
        height: 22rem;
        left: -4rem;
        top: 6%;
        background: var(--color-accent);
        opacity: 0.26;
        animation: authFloat1 15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      .auth-orb-2 {
        width: 19rem;
        height: 19rem;
        right: -3rem;
        bottom: 4%;
        background: var(--color-accent-light);
        opacity: 0.2;
        animation: authFloat2 19s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      @keyframes authFloat1 {
        0%,
        100% {
          transform: translate3d(0, 0, 0);
        }
        50% {
          transform: translate3d(1.25rem, -1.5rem, 0);
        }
      }
      @keyframes authFloat2 {
        0%,
        100% {
          transform: translate3d(0, 0, 0);
        }
        50% {
          transform: translate3d(-1.15rem, 1.25rem, 0);
        }
      }

      /* "In tune" equalizer beside the wordmark — a living nod to voice/harmony.
         Animates transform (scaleY), never height, so it stays on the compositor. */
      .auth-eq {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 15px;
      }
      .auth-eq i {
        width: 2px;
        height: 100%;
        border-radius: 2px;
        background: var(--color-accent-light);
        transform-origin: bottom;
        transform: scaleY(0.4);
        opacity: 0.85;
        animation: authEq 1.15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      .auth-eq i:nth-child(1) {
        animation-delay: 0ms;
      }
      .auth-eq i:nth-child(2) {
        animation-delay: 180ms;
      }
      .auth-eq i:nth-child(3) {
        animation-delay: 360ms;
      }
      .auth-eq i:nth-child(4) {
        animation-delay: 120ms;
      }
      @keyframes authEq {
        0%,
        100% {
          transform: scaleY(0.35);
        }
        50% {
          transform: scaleY(1);
        }
      }

      /* Reduced motion: freeze the ambient life, keep the composition intact.
         Covers both the OS setting and the in-app accessibility toggle. */
      @media (prefers-reduced-motion: reduce) {
        .auth-orb,
        .auth-eq i {
          animation: none;
        }
        .auth-eq i {
          transform: scaleY(0.6);
        }
      }
      :host-context(html.reduce-motion) .auth-orb,
      :host-context(html.reduce-motion) .auth-eq i {
        animation: none;
      }
      :host-context(html.reduce-motion) .auth-eq i {
        transform: scaleY(0.6);
      }
    `,
  ],
})
export class AuthShell {
  protected readonly year = new Date().getFullYear();
}
