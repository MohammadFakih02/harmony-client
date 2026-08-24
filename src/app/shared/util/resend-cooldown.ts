import { WritableSignal } from '@angular/core';

/**
 * Runs the shared "resend code" cooldown used by the auth/2FA/credential-change screens: sets `cooldown`
 * to `seconds` and ticks it down to 0 once a second, replacing any timer still tracked by `previous`.
 * Returns the new interval handle so the caller can store it (and `clearInterval` it on destroy).
 */
export function runResendCooldown(
  cooldown: WritableSignal<number>,
  previous: ReturnType<typeof setInterval> | undefined,
  seconds = 60,
): ReturnType<typeof setInterval> {
  cooldown.set(seconds);
  clearInterval(previous);
  const timer = setInterval(() => {
    const next = cooldown() - 1;
    if (next <= 0) {
      cooldown.set(0);
      clearInterval(timer);
    } else {
      cooldown.set(next);
    }
  }, 1000);
  return timer;
}
