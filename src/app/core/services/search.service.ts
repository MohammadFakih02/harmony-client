import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SearchResults } from '../models/search.models';

/** Resolved operator filters + the pagination cursor sent to the search endpoints. */
export interface SearchOptions {
  channelId?: string;
  /** Author id (`from:`). */
  from?: string;
  /** Inclusive lower bound on createdAt, unix-ms (`after:` / `during:` start). */
  after?: number;
  /** Exclusive upper bound on createdAt, unix-ms — the operator bound AND the "load more" cursor. */
  before?: number;
  hasLink?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /**
   * Full-text search within a guild. Operator filters (parsed client-side from `from:`/`in:`/`has:`/
   * date operators): `channelId` (`in:`) narrows to one channel, `from` to one author, `after`/`before`
   * bound `createdAt` (unix-ms), `hasLink` keeps only messages containing a URL. `before` doubles as
   * the "load more" keyset cursor. The server filters hits to channels the caller can view.
   */
  search(guildId: string, query: string, options: SearchOptions = {}): Promise<SearchResults> {
    return firstValueFrom(
      this.http.get<SearchResults>(`${this.base}/guilds/${guildId}/search`, {
        params: this.buildParams(query, options),
      }),
    );
  }

  /**
   * Full-text search within a single DM / group-DM channel the caller participates in. Guild-less
   * and inherently channel-scoped (so no `in:` operator). Same `from`/`after`/`before`/`hasLink`
   * filters as the guild search; `before` also pages older.
   */
  searchDmChannel(
    channelId: string,
    query: string,
    options: Omit<SearchOptions, 'channelId'> = {},
  ): Promise<SearchResults> {
    return firstValueFrom(
      this.http.get<SearchResults>(`${this.base}/dm/${channelId}/search`, {
        params: this.buildParams(query, options),
      }),
    );
  }

  private buildParams(query: string, options: SearchOptions): Record<string, string> {
    const params: Record<string, string> = { q: query };
    if (options.channelId != null) params['channelId'] = options.channelId;
    if (options.from != null) params['from'] = options.from;
    if (options.after != null) params['after'] = String(options.after);
    if (options.before != null) params['before'] = String(options.before);
    if (options.hasLink) params['hasLink'] = 'true';
    return params;
  }
}
