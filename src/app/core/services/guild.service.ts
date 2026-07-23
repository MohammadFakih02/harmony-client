import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildSummary } from '../models/guild.models';

/** A soft-deleted guild as shown in the owner's global Trash (§5.71 #5). deletedAt is unix-ms. */
export interface DeletedGuild {
  id: string;
  name: string;
  iconKey: string | null;
  deletedAt: number;
}

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
    patch: {
      name?: string;
      description?: string | null;
      isPublic?: boolean;
      requireVerifiedEmail?: boolean;
    },
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

  /** Persist the caller's personal guild-rail order (full id list, first = top). */
  updateGuildOrder(guildIds: string[]): Promise<void> {
    return firstValueFrom(
      this.http.patch<void>(`${this.base}/users/me/guild-order`, { guildOrder: guildIds }),
    );
  }

  /** Leave a guild (non-owner). The API rejects an owner with a 400. */
  leaveGuild(guildId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/guilds/${guildId}/leave`));
  }

  /** Delete a guild (owner only). Soft-delete — recoverable from Trash (§5.71 #5). */
  deleteGuild(guildId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/guilds/${guildId}`));
  }

  // ---- Trash / restore (owner only; §5.71 #5) ----

  /** Guilds the caller owns that they've soft-deleted — their global Trash. */
  getTrash(): Promise<DeletedGuild[]> {
    return firstValueFrom(this.http.get<DeletedGuild[]>(`${this.base}/guilds/trash`));
  }

  /** Restore a trashed guild (owner only). Returns the live guild for re-adding to the rail. */
  restoreGuild(guildId: string): Promise<GuildSummary> {
    return firstValueFrom(
      this.http.post<GuildSummary>(`${this.base}/guilds/${guildId}/restore`, null),
    );
  }

  /** Permanently delete a trashed guild now (irreversible — purges all its channels/messages). */
  permanentDeleteGuild(guildId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/guilds/${guildId}/permanent`));
  }

  // ---- guild assets (icon/banner) — ManageGuild-scoped presign → PUT → confirm ----

  presignAsset(
    guildId: string,
    kind: 'icon' | 'banner',
    req: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }> {
    return firstValueFrom(
      this.http.post<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }>(
        `${this.base}/guilds/${guildId}/${kind}/presign`,
        req,
      ),
    );
  }

  confirmAsset(guildId: string, kind: 'icon' | 'banner', fileId: string): Promise<{ key: string }> {
    return firstValueFrom(
      this.http.post<{ key: string }>(
        `${this.base}/guilds/${guildId}/${kind}/${fileId}/confirm`,
        null,
      ),
    );
  }

  removeAsset(guildId: string, kind: 'icon' | 'banner'): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.base}/guilds/${guildId}/${kind}`));
  }

  // ---- discovery (public servers) ----

  /** Browse discoverable (public) guilds, biggest first; optional name filter. */
  discover(query?: string): Promise<GuildSummary[]> {
    const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return firstValueFrom(this.http.get<GuildSummary[]>(`${this.base}/guilds/discover${q}`));
  }

  /** Join a discoverable guild without an invite. Returns the joined guild. */
  joinPublic(guildId: string): Promise<GuildSummary> {
    return firstValueFrom(this.http.post<GuildSummary>(`${this.base}/guilds/${guildId}/join`, null));
  }
}
