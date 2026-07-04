import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildSummary } from '../models/guild.models';

@Injectable({ providedIn: 'root' })
export class GuildService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getMyGuilds(): Promise<GuildSummary[]> {
    return firstValueFrom(this.http.get<GuildSummary[]>(`${this.base}/users/me/guilds`));
  }

  createGuild(name: string, description?: string): Promise<GuildSummary> {
    return firstValueFrom(
      this.http.post<GuildSummary>(`${this.base}/guilds`, { name, description: description ?? null }),
    );
  }

  /** Update guild metadata (ManageGuild). Returns the full updated guild. */
  updateGuild(
    guildId: string,
    patch: { name?: string; description?: string | null; isPublic?: boolean },
  ): Promise<GuildSummary> {
    return firstValueFrom(this.http.patch<GuildSummary>(`${this.base}/guilds/${guildId}`, patch));
  }

  /** Replace a guild's welcome configuration (ManageGuild). Returns the full updated guild. */
  updateWelcome(
    guildId: string,
    config: {
      welcomeChannelId: string | null;
      welcomeMessage: string | null;
      systemMessagesEnabled: boolean;
    },
  ): Promise<GuildSummary> {
    return firstValueFrom(
      this.http.patch<GuildSummary>(`${this.base}/guilds/${guildId}/welcome`, config),
    );
  }

  /** Leave a guild (non-owner). The API rejects an owner with a 400. */
  leaveGuild(guildId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/guilds/${guildId}/leave`));
  }

  /** Delete a guild (owner only). */
  deleteGuild(guildId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/guilds/${guildId}`));
  }
}
