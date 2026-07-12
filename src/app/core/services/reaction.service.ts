import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * REST calls for emoji reactions. Mirrors MessageService's guild-vs-DM route branch: a guild
 * channel nests under its guild, a DM (guildId null) lives under /dm/{channelId}. The emoji travels
 * in the body (PUT) / query (DELETE), never a path segment — a Unicode char in a route is fragile.
 * The authoritative pill state arrives back via the ReactionAdded/ReactionRemoved gateway events;
 * these just fire the write.
 */
@Injectable({ providedIn: 'root' })
export class ReactionService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private reactionsUrl(guildId: string | null, channelId: string, messageId: string): string {
    return guildId == null
      ? `${this.base}/dm/${channelId}/messages/${messageId}/reactions`
      : `${this.base}/guilds/${guildId}/channels/${channelId}/messages/${messageId}/reactions`;
  }

  add(guildId: string | null, channelId: string, messageId: string, emoji: string): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(this.reactionsUrl(guildId, channelId, messageId), { emoji }),
    );
  }

  remove(guildId: string | null, channelId: string, messageId: string, emoji: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(this.reactionsUrl(guildId, channelId, messageId), {
        params: { emoji },
      }),
    );
  }
}
