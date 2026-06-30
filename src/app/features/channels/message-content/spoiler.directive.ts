import { Directive, signal } from '@angular/core';

/**
 * Click-to-reveal spoiler. Each ||spoiler|| span carries its own reveal state, so one revealed
 * spoiler doesn't uncover the others. Hidden: a solid box with transparent, non-selectable text;
 * revealed: normal text (selection re-enabled, inheriting the message list's select-text).
 */
@Directive({
  selector: '[appSpoiler]',
  standalone: true,
  host: {
    class: 'rounded px-1 transition-colors',
    '[class.bg-surface-3]': '!revealed()',
    '[class.text-transparent]': '!revealed()',
    '[class.cursor-pointer]': '!revealed()',
    '[class.select-none]': '!revealed()',
    '[class.bg-surface-2]': 'revealed()',
    '[attr.title]': "!revealed() ? 'Reveal spoiler' : null",
    '(click)': 'reveal()',
  },
})
export class SpoilerDirective {
  readonly revealed = signal(false);

  reveal(): void {
    this.revealed.set(true);
  }
}
