import { Component, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMOJI_CATEGORIES, EmojiItem, searchEmojis } from '../../util/emoji-data';
import { getRecents, pushRecent } from '../../util/emoji-recents';

/**
 * Presentational Unicode emoji picker for the composer. Self-contained: owns its search/category
 * state and reads/writes the localStorage recents directly (no store). Emits the chosen emoji
 * character via `select`; the host inserts it at the caret and keeps the picker open (Discord-style).
 */
@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './emoji-picker.html',
})
export class EmojiPicker {
  readonly select = output<string>();

  protected readonly categories = EMOJI_CATEGORIES;
  protected readonly search = signal('');
  protected readonly recents = signal<string[]>(getRecents());
  protected readonly activeCategoryId = signal<string>(
    getRecents().length ? 'recents' : EMOJI_CATEGORIES[0].id,
  );

  protected readonly hasRecents = computed(() => this.recents().length > 0);
  protected readonly isSearching = computed(() => this.search().trim().length > 0);

  // Lookup so a recent char (stored as just the character) can recover its name for the tooltip.
  private readonly byChar = new Map<string, EmojiItem>(
    EMOJI_CATEGORIES.flatMap((c) => c.emojis).map((e) => [e.char, e] as const),
  );
  private itemFor(char: string): EmojiItem {
    return this.byChar.get(char) ?? { char, name: char, keywords: [] };
  }

  /** Emoji shown in the grid: flat search results, the recents, or the active category's set. */
  protected readonly displayed = computed<EmojiItem[]>(() => {
    if (this.isSearching()) return searchEmojis(this.search());
    if (this.activeCategoryId() === 'recents') return this.recents().map((c) => this.itemFor(c));
    return this.categories.find((c) => c.id === this.activeCategoryId())?.emojis ?? [];
  });

  /** Heading above the grid (search → "Search Results", else the category/recents name). */
  protected readonly heading = computed<string>(() => {
    if (this.isSearching()) return 'Search Results';
    if (this.activeCategoryId() === 'recents') return 'Frequently Used';
    return this.categories.find((c) => c.id === this.activeCategoryId())?.name ?? '';
  });

  protected pick(char: string): void {
    this.recents.set(pushRecent(char));
    this.select.emit(char);
  }

  protected setCategory(id: string): void {
    this.search.set('');
    this.activeCategoryId.set(id);
  }
}
