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
}
