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
import { SearchService, SearchOptions } from '../../../core/services/search.service';
import { SearchResult } from '../../../core/models/search.models';
import { MessageStore } from '../../../core/stores/message.store';
import { MemberStore } from '../../../core/stores/member.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { UiAvatar } from '../../../shared/ui';
import {
  ParsedQuery,
  SearchOperator,
  SearchToken,
  SEARCH_OPERATORS,
  activeFragment,
  parseDateValue,
  parseSearchQuery,
  serializeSearchQuery,
} from '../../../shared/util/search-query';

const DEBOUNCE_MS = 400;

/** A snippet split into plain + matched segments so query terms can be highlighted without innerHTML. */
interface HighlightSegment {
  text: string;
  match: boolean;
}

/** One row in the autocomplete dropdown — either an operator-name hint or a value pick. */
interface Suggestion {
  /** The value to insert (an operator row inserts `op:`; a value row inserts the value). */
  insert: string;
  primary: string;
  secondary?: string;
  icon?: string;
  avatarKey?: string | null;
  isOperator?: boolean;
}

/** One-line help shown beside each operator suggestion. */
const OP_HINTS: Record<SearchOperator, string> = {
  from: 'messages from a user',
  in: 'messages in a channel',
  has: 'messages containing…',
  before: 'sent before a date',
  after: 'sent after a date',
  during: 'sent on a date',
};

/** `has:` currently supports only `link` — attachment filters (image/file) need the Scylla→Postgres
 *  message↔attachment linkage the search table doesn't carry, so they're deliberately out of v1. */
const HAS_VALUES = ['link'];

/**
 * Message search dropdown (flow #26) with Discord-style operators. Two scopes: a guild search (pass
 * `guildId`) spanning every channel the caller can view, or a DM/group-DM search (pass `dmChannelId`)
 * scoped to that one channel. The raw input is parsed into free text + operator tokens (`from:`, `in:`,
 * `has:`, `before:`/`after:`/`during:`); tokens render as removable chips and drive an autocomplete
 * dropdown (member/channel/value pickers). Clicking a result jumps to that message.
 */
@Component({
  selector: 'app-search-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  templateUrl: './search-panel.html',
  host: {
    class:
      'block w-[26rem] max-w-[calc(100vw-1rem)] max-h-[32rem] rounded-lg bg-surface-2 border border-border shadow-2xl overflow-hidden flex flex-col',
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
  private readonly memberStore = inject(MemberStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly dmStore = inject(DmStore);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly query = signal('');
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  // Whether a query has actually been run — distinguishes the initial empty panel from "no results".
  protected readonly searched = signal(false);

  // Structured view of the raw input — chips render from `tokens`, highlighting uses `text`.
  protected readonly parsed = computed<ParsedQuery>(() => parseSearchQuery(this.query()));

  private readonly terms = computed(() =>
    this.parsed()
      .text.toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );

  // Autocomplete: the trailing fragment being typed drives the suggestion list. Escape dismisses it
  // until the next keystroke (so a user can Escape the dropdown without closing the whole panel).
  private readonly dismissed = signal(false);
  protected readonly highlightedIndex = signal(0);

  private readonly fragment = computed(() =>
    this.dismissed() ? null : activeFragment(this.query()),
  );

  protected readonly suggestions = computed<Suggestion[]>(() => {
    const frag = this.fragment();
    if (!frag) return [];

    if (frag.kind === 'operator') {
      return SEARCH_OPERATORS.filter(
        (o) => o.startsWith(frag.partial) && (o !== 'in' || !!this.guildId()),
      ).map((o) => ({ insert: `${o}:`, primary: `${o}:`, secondary: OP_HINTS[o], isOperator: true }));
    }

    switch (frag.op) {
      case 'from':
        return this.peopleFor(frag.partial);
      case 'in':
        return this.guildId() ? this.channelsFor(frag.partial) : [];
      case 'has':
        return HAS_VALUES.filter((v) => v.startsWith(frag.partial)).map((v) => ({
          insert: v,
          primary: v,
          icon: 'fa-link',
        }));
      case 'before':
      case 'after':
      case 'during':
        return this.datesFor(frag.partial);
      default:
        return [];
    }
  });

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    // Focus the input as the overlay opens, and warm the member cache so `from:` can suggest.
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
    const g = this.guildId();
    if (g) void this.memberStore.loadIfNeeded(g);
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.dismissed.set(false);
    this.highlightedIndex.set(0);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    // Reset when the box is emptied; otherwise debounce a run (operator-only queries search too).
    if (value.trim().length === 0) {
      this.results.set([]);
      this.hasMore.set(false);
      this.searched.set(false);
      return;
    }
    this.debounceTimer = setTimeout(() => void this.run(false), DEBOUNCE_MS);
  }

  /** Keyboard flow: arrows/enter/tab drive the suggestion list when open; otherwise enter runs and
   *  escape closes the panel. Escape with suggestions open only dismisses the dropdown. */
  protected onKeydown(event: KeyboardEvent): void {
    const suggestions = this.suggestions();
    if (suggestions.length > 0) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.highlightedIndex.update((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.highlightedIndex.update((i) => Math.max(i - 1, 0));
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          this.applySuggestion(suggestions[this.highlightedIndex()] ?? suggestions[0]);
          return;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          this.dismissed.set(true);
          return;
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void this.run(false);
    } else if (event.key === 'Escape') {
      this.close.emit();
    }
  }

  /** Replaces the trailing fragment with the chosen operator/value, then re-focuses and (for a value)
   *  re-runs the search. */
  protected applySuggestion(s: Suggestion): void {
    const frag = activeFragment(this.query());
    if (!frag) return;

    const replacement = s.isOperator
      ? s.insert // "from:" — wait for the value
      : `${frag.op}:${/\s/.test(s.insert) ? `"${s.insert}"` : s.insert} `;

    this.query.set(this.query().slice(0, frag.start) + replacement);
    // Picking an OPERATOR (e.g. `before:`) must keep the dropdown open so its value suggestions
    // (today / yesterday / date, or `link` for has:) appear immediately — dismissing here was why
    // they never showed. A VALUE pick is complete, so dismiss until the next keystroke.
    this.dismissed.set(!s.isOperator);
    this.highlightedIndex.set(0);
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
    if (!s.isOperator) void this.run(false);
  }

  /** Removes an operator chip — the raw input is rewritten to its normalised (operators-first) form. */
  protected removeToken(token: SearchToken): void {
    const parsed = this.parsed();
    let removed = false;
    const tokens = parsed.tokens.filter((t) => {
      if (!removed && t.op === token.op && t.value === token.value) {
        removed = true;
        return false;
      }
      return true;
    });
    this.query.set(serializeSearchQuery({ text: parsed.text, tokens }));
    this.dismissed.set(true);
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
    void this.run(false);
  }

  /** Turns the parsed tokens into resolved API filters (names → ids, dates → unix-ms). Unresolvable
   *  tokens (an unknown name, a bad date) are dropped rather than mangling the query. Last wins per op. */
  private resolveFilters(parsed: ParsedQuery): SearchOptions {
    const byOp = new Map<SearchOperator, string>();
    for (const t of parsed.tokens) byOp.set(t.op, t.value);

    const opts: SearchOptions = {};

    const fromVal = byOp.get('from');
    if (fromVal) {
      const id = this.resolveUser(fromVal);
      if (id) opts.from = id;
    }

    const inVal = byOp.get('in');
    if (inVal && this.guildId()) {
      const id = this.resolveChannel(inVal);
      if (id) opts.channelId = id;
    }

    if (byOp.get('has')?.toLowerCase() === 'link') opts.hasLink = true;

    // Date bounds: `during` sets both ends of a day/month/year; explicit after/before override.
    const during = byOp.get('during');
    if (during) {
      const span = parseDateValue(during);
      if (span) {
        opts.after = span.start;
        opts.before = span.end;
      }
    }
    const after = byOp.get('after');
    if (after) {
      const span = parseDateValue(after);
      if (span) opts.after = span.start;
    }
    const before = byOp.get('before');
    if (before) {
      const span = parseDateValue(before);
      if (span) opts.before = span.start;
    }

    return opts;
  }

  private hasAnyFilter(opts: SearchOptions): boolean {
    return (
      opts.channelId != null ||
      opts.from != null ||
      opts.after != null ||
      opts.before != null ||
      !!opts.hasLink
    );
  }

  /** Runs the search. `append` = "load more" (page older via the last result's createdAt cursor). */
  private async run(append: boolean): Promise<void> {
    const guildId = this.guildId();
    const dmChannelId = this.dmChannelId();
    if (!guildId && !dmChannelId) return;

    const parsed = this.parsed();
    const text = parsed.text.trim();
    const filters = this.resolveFilters(parsed);

    // Nothing to search: no free text and no effective operator filter.
    if (text.length === 0 && !this.hasAnyFilter(filters)) {
      if (!append) {
        this.results.set([]);
        this.hasMore.set(false);
        this.searched.set(false);
      }
      return;
    }

    // First page honours a `before:` bound; "load more" pages from the last result (always older).
    const before = append ? this.results().at(-1)?.createdAt : filters.before;

    this.loading.set(true);
    try {
      const page = dmChannelId
        ? await this.service.searchDmChannel(dmChannelId, text, {
            from: filters.from,
            after: filters.after,
            before,
            hasLink: filters.hasLink,
          })
        : await this.service.search(guildId!, text, { ...filters, before });
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

  // ── Suggestion sources ──────────────────────────────────────────────────────────────────────

  private peopleFor(partial: string): Suggestion[] {
    const g = this.guildId();
    const people = g
      ? this.memberStore.membersOf(g).map((m) => ({
          username: m.username,
          display: m.nickname ?? m.username,
          avatarKey: m.avatarKey,
        }))
      : (this.dmStore.dms().find((d) => d.channelId === this.dmChannelId())?.participants ?? []).map(
          (p) => ({ username: p.username, display: p.username, avatarKey: p.avatarKey }),
        );

    return people
      .filter(
        (p) =>
          p.username.toLowerCase().includes(partial) ||
          p.display.toLowerCase().includes(partial),
      )
      .slice(0, 8)
      .map((p) => ({
        insert: p.username,
        primary: p.display,
        secondary: p.display === p.username ? undefined : `@${p.username}`,
        avatarKey: p.avatarKey,
      }));
  }

  private channelsFor(partial: string): Suggestion[] {
    const g = this.guildId();
    if (!g) return [];
    const needle = partial.replace(/^#/, '');
    return (this.channelStore.channelsByGuild()[g] ?? [])
      .filter((c) => (c.type === 'text' || c.type === 'announcement') && c.name.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((c) => ({ insert: c.name, primary: `#${c.name}`, icon: 'fa-hashtag' }));
  }

  private datesFor(partial: string): Suggestion[] {
    const presets = ['today', 'yesterday'];
    const rows: Suggestion[] = presets
      .filter((p) => p.startsWith(partial))
      .map((p) => ({ insert: p, primary: p, icon: 'fa-calendar-day' }));
    // Always offer the explicit-format hint (non-inserting guidance).
    if (partial.length === 0 || /^\d/.test(partial)) {
      rows.push({ insert: partial, primary: partial || 'YYYY-MM-DD', secondary: 'e.g. 2026-01-31', icon: 'fa-calendar' });
    }
    return rows;
  }

  private resolveUser(value: string): string | null {
    const v = value.toLowerCase();
    const g = this.guildId();
    if (g) {
      const m = this.memberStore
        .membersOf(g)
        .find((x) => x.username.toLowerCase() === v || x.nickname?.toLowerCase() === v);
      return m?.userId ?? null;
    }
    const dm = this.dmStore.dms().find((d) => d.channelId === this.dmChannelId());
    return dm?.participants.find((p) => p.username.toLowerCase() === v)?.userId ?? null;
  }

  private resolveChannel(value: string): string | null {
    const g = this.guildId();
    if (!g) return null;
    const needle = value.replace(/^#/, '').toLowerCase();
    return (
      (this.channelStore.channelsByGuild()[g] ?? []).find((c) => c.name.toLowerCase() === needle)
        ?.id ?? null
    );
  }

  // ── Result rendering ────────────────────────────────────────────────────────────────────────

  protected selectResult(result: SearchResult): void {
    if (this.messageStore.activeChannelId() === result.channelId) {
      void this.messageStore.jumpToMessage(result.guildId, result.channelId, result.messageId);
    } else {
      this.messageStore.requestChannelJump(result.guildId, result.channelId, result.messageId);
      const route = result.guildId
        ? ['/app/guilds', result.guildId, 'channels', result.channelId]
        : ['/app/dm', result.channelId];
      void this.router.navigate(route);
    }
    this.close.emit();
  }

  /** Splits a result's content around the free-text query terms so matches render bold (no innerHTML). */
  protected highlight(content: string): HighlightSegment[] {
    const terms = this.terms();
    if (terms.length === 0) return [{ text: content, match: false }];

    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = content.split(re);
    const matchSet = new Set(terms);
    return parts
      .filter((p) => p.length > 0)
      .map((p) => ({ text: p, match: matchSet.has(p.toLowerCase()) }));
  }

  /** Chip label: `from:` / `in:` show the friendly name, others the raw value. */
  protected tokenLabel(token: SearchToken): string {
    return `${token.op}: ${token.value}`;
  }

  protected formatTime(createdAt: number): string {
    return new Date(createdAt).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
