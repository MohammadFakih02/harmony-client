import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SearchResults } from '../models/search.models';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /**
   * Full-text search within a guild. `channelId` narrows to one channel; `before` (a result's
   * createdAt) pages older. The server filters hits to channels the caller can view.
   */
  search(
    guildId: string,
    query: string,
    options: { channelId?: string; before?: number } = {},
  ): Promise<SearchResults> {
    const params: Record<string, string> = { q: query };
    if (options.channelId != null) params['channelId'] = options.channelId;
    if (options.before != null) params['before'] = String(options.before);
    return firstValueFrom(
      this.http.get<SearchResults>(`${this.base}/guilds/${guildId}/search`, { params }),
    );
  }

  /**
   * Full-text search within a single DM / group-DM channel the caller participates in. Guild-less
   * and inherently channel-scoped (unlike a guild search, which spans visible channels). `before`
   * (a result's createdAt) pages older.
   */
  searchDmChannel(
    channelId: string,
    query: string,
    options: { before?: number } = {},
  ): Promise<SearchResults> {
    const params: Record<string, string> = { q: query };
    if (options.before != null) params['before'] = String(options.before);
    return firstValueFrom(
      this.http.get<SearchResults>(`${this.base}/dm/${channelId}/search`, { params }),
    );
  }
}
