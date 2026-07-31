import { Injectable } from '@angular/core';

/**
 * A tiny throwaway confetti burst — the app's one easter egg. Sending a message with 🎉 in it fires
 * it. Pure DOM + the Web Animations API (no library, no CSS keyframes); the container removes itself
 * once the animation finishes. Honours "reduce motion" (WAAPI isn't covered by the global CSS guard,
 * so it's checked here explicitly) and is a no-op outside a browser.
 */
@Injectable({ providedIn: 'root' })
export class ConfettiService {
  private static readonly COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];

  burst(count = 90): void {
    if (typeof document === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const container = document.createElement('div');
    container.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    document.body.appendChild(container);

    let longest = 0;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      const size = 6 + Math.random() * 6;
      const dx = (Math.random() - 0.5) * 320;
      const rot = Math.random() * 720 - 360;
      const duration = 1800 + Math.random() * 1400;
      longest = Math.max(longest, duration);
      piece.style.cssText =
        `position:absolute;bottom:-20px;left:${Math.random() * 100}vw;` +
        `width:${size}px;height:${size * 0.6}px;` +
        `background:${ConfettiService.COLORS[i % ConfettiService.COLORS.length]};border-radius:1px`;
      piece.animate(
        [
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(${dx}px, -${65 + Math.random() * 25}vh) rotate(${rot}deg)`,
            opacity: 1,
            offset: 0.7,
          },
          {
            transform: `translate(${dx * 1.2}px, -${85 + Math.random() * 10}vh) rotate(${rot * 1.4}deg)`,
            opacity: 0,
          },
        ],
        { duration, easing: 'cubic-bezier(0.2,0.6,0.3,1)', fill: 'forwards' },
      );
      container.appendChild(piece);
    }
    setTimeout(() => container.remove(), longest + 200);
  }
}
