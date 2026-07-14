import { Component, input, output } from '@angular/core';
import { EmojiItem } from '../../util/emoji-data';

/**
 * The `:shortcode` autocomplete popup — the emoji sibling of `app-mention-autocomplete`.
 * Dumb list: the composer owns the trigger detection, filtering, and keyboard navigation.
 */
@Component({
  selector: 'app-emoji-suggest',
  standalone: true,
  template: `
    <div class="w-64 max-h-60 overflow-y-auto rounded-lg bg-surface-2 ring-1 ring-border-subtle shadow-modal py-1">
      @if (candidates().length === 0) {
      <p class="text-xs text-faint text-center py-3">No matches</p>
      } @else {
      @for (emoji of candidates(); track emoji.char; let i = $index) {
      <button
        type="button"
        class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-micro"
        [class.bg-accent]="i === highlightedIndex()"
        [class.text-white]="i === highlightedIndex()"
        [class.hover:bg-surface-3]="i !== highlightedIndex()"
        (click)="select.emit(emoji)"
      >
        <span class="w-6 text-center text-base shrink-0">{{ emoji.char }}</span>
        <span class="text-sm font-medium truncate">:{{ slug(emoji) }}:</span>
      </button>
      }
      }
    </div>
  `,
})
export class EmojiSuggest {
  candidates = input<EmojiItem[]>([]);
  highlightedIndex = input(0);

  select = output<EmojiItem>();

  /** The insertable shortcode shown beside the emoji (name, snake_cased). */
  protected slug(emoji: EmojiItem): string {
    return emoji.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }
}
