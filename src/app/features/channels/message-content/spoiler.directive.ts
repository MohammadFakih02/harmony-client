import { Directive, computed, signal } from '@angular/core';

/**
 * Click-to-reveal spoiler. Each ||spoiler|| span carries its own reveal state, so one revealed
 * spoiler doesn't uncover the others.
 *
 * Hidden state uses `[&_*]:invisible` (visibility on every descendant), NOT inherited
 * `text-transparent`: mention chips, role chips (inline colour styles), links, and inline code
 * all carry their own colour/background, which override an inherited transparent colour and
 * leaked through the redaction box. visibility hides paint entirely while keeping layout, and
 * hidden descendants don't hit-test, so the click still lands on this host.
 */
@Directive({
  selector: '[appSpoiler]',
  standalone: true,
  host: {
    '[class]': 'hostClasses()',
    '[attr.title]': "!revealed() ? 'Reveal spoiler' : null",
    '(click)': 'reveal()',
  },
})
export class SpoilerDirective {
  readonly revealed = signal(false);

  protected readonly hostClasses = computed(() =>
    this.revealed()
      ? 'rounded px-1 transition-colors bg-surface-2'
      : 'rounded px-1 transition-colors bg-surface-3 cursor-pointer select-none [&_*]:invisible',
  );

  reveal(): void {
    this.revealed.set(true);
  }
}
