import { Injectable } from '@angular/core';

/**
 * Looping call ring sounds (Slice 4). The assets are user-supplied files in `public/sounds/` —
 * a missing file or an autoplay rejection must never break the ring UX, so every audio failure
 * degrades to visual-only. On autoplay rejection a one-shot `pointerdown` listener retries once
 * the user interacts, as long as the same ring is still active.
 */
@Injectable({ providedIn: 'root' })
export class RingtoneService {
  private audio: HTMLAudioElement | null = null;
  private retryListener: (() => void) | null = null;

  /** The callee-side ringtone — loops until the ring is answered/declined/dismissed. */
  playIncoming(): void {
    this.play('/sounds/ringtone.mp3', 0.5);
  }

  /** The caller-side outgoing ring — quieter; loops while waiting for an answer. */
  playOutgoing(): void {
    this.play('/sounds/outgoing-call.mp3', 0.25);
  }

  stop(): void {
    this.clearRetry();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
  }

  private play(src: string, volume: number): void {
    this.stop();
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = volume;
    this.audio = audio;
    audio.play().catch(() => {
      // Autoplay blocked (no user gesture yet) or the asset is missing. Retry once on the next
      // interaction — if the ring already ended, stop() cleared the listener and this no-ops.
      this.clearRetry();
      this.retryListener = () => {
        this.retryListener = null;
        if (this.audio === audio) audio.play().catch(() => {});
      };
      document.addEventListener('pointerdown', this.retryListener, { once: true });
    });
  }

  private clearRetry(): void {
    if (this.retryListener) {
      document.removeEventListener('pointerdown', this.retryListener);
      this.retryListener = null;
    }
  }
}
