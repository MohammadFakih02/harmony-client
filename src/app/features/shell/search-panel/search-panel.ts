import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { SearchService } from '../../../core/services/search.service';
import { SearchResult } from '../../../core/models/search.models';
import { MessageStore } from '../../../core/stores/message.store';
import { UiAvatar } from '../../../shared/ui';

const DEBOUNCE_MS = 400;

/** A snippet split into plain + matched segments so query terms can be highlighted without innerHTML. */
interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Message search dropdown (flow #26). Two scopes: a guild search (pass `guildId`) spanning every
 * channel the caller can view, or a DM/group-DM search (pass `dmChannelId`) scoped to that one
 * channel. Debounced full-text query; clicking a result jumps to that message (loading a window
 * around it via the store's anchored-history mode), navigating to the channel first if needed.
 */
@Component({
  selector: 'app-search-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  templateUrl: './search-panel.html',
  host: {
    class:
      'block w-[26rem] max-h-[32rem] rounded-lg bg-surface-2 border border-border shadow-2xl overflow-hidden flex flex-col',
  },
})
export class SearchPanel implements OnInit, OnDestroy {
  // Exactly one scope is supplied: a guild search or a single-DM-channel search.
  readonly guildId = input<string | null>(null);
  readonly dmChannelId = input<string | null>(null);
  readonly close = output<void>();

  private readonly service = inject(SearchService);
  private readonly router = inject(Router);
  private readonly messageStore = inject(MessageStore);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly query = signal('');
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  // Whether a query has actually been run — distinguishes the initial empty panel from "no results".
  protected readonly searched = signal(false);

  private readonly terms = computed(() =>
    this.query()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    // Focus the input as the overlay opens.
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    if (value.trim().length === 0) {
      this.results.set([]);
      this.hasMore.set(false);
      this.searched.set(false);
      return;
    }

    this.debounceTimer = setTimeout(() => void this.run(false), DEBOUNCE_MS);
  }

  /** Runs the search. `append` = "load more" (page older via the last result's createdAt cursor). */
  private async run(append: boolean): Promise<void> {
    const q = this.query().trim();
    if (q.length === 0) return;

    const guildId = this.guildId();
    const dmChannelId = this.dmChannelId();
    if (!guildId && !dmChannelId) return;

    const before = append ? this.results().at(-1)?.createdAt : undefined;
    this.loading.set(true);
    try {
      const page = dmChannelId
        ? await this.service.searchDmChannel(dmChannelId, q, { before })
        : await this.service.search(guildId!, q, { before });
      this.results.set(append ? [...this.results(), ...page.results] : page.results);
      this.hasMore.set(page.hasMore);
      this.searched.set(true);
    } catch {
      if (!append) this.results.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore(): void {
    if (!this.loading()) void this.run(true);
  }

  protected selectResult(result: SearchResult): void {
    if (this.messageStore.activeChannelId() === result.channelId) {
      // Already in the target channel — jump within it.
      void this.messageStore.jumpToMessage(result.guildId, result.channelId, result.messageId);
    } else {
      // Park the target, then navigate; the channel component loads the window on arrival. A DM
      // result (guildId null) routes to /app/dm, a guild result to its channel.
      this.messageStore.requestChannelJump(result.guildId, result.channelId, result.messageId);
      const route = result.guildId
        ? ['/app/guilds', result.guildId, 'channels', result.channelId]
        : ['/app/dm', result.channelId];
      void this.router.navigate(route);
    }
    this.close.emit();
  }

  /** Splits a result's content around the query terms so matches render bold (no innerHTML). */
  protected highlight(content: string): HighlightSegment[] {
    const terms = this.terms();
    if (terms.length === 0) return [{ text: content, match: false }];

    // Case-insensitive match of any whole term; escape regex metacharacters in the terms.
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = content.split(re);
    const matchSet = new Set(terms);
    return parts
      .filter((p) => p.length > 0)
      .map((p) => ({ text: p, match: matchSet.has(p.toLowerCase()) }));
  }

  protected formatTime(createdAt: number): string {
    return new Date(createdAt).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
