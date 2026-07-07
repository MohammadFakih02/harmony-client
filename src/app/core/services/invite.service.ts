import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateInviteOptions, Invite, InviteEmbedPreview, InvitePreview } from '../models/invite.models';
import { GuildSummary } from '../models/guild.models';

/**
 * Wire shape of an invite — the API serializes `long` (createdAt/expiresAt) as strings via the
 * LongStringConverter, so we coerce those to numbers in {@link InviteService.coerce}.
 */
interface RawInvite extends Omit<Invite, 'createdAt' | 'expiresAt'> {
  createdAt: string;
  expiresAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Mint a managed invite for a guild (CreateInvite). */
  async createInvite(guildId: string, options: CreateInviteOptions = {}): Promise<Invite> {
    const raw = await firstValueFrom(
      this.http.post<RawInvite>(`${this.base}/guilds/${guildId}/invites`, {
        channelId: options.channelId ?? null,
        maxUses: options.maxUses ?? null,
        expiresInSeconds: options.expiresInSeconds ?? null,
      }),
    );
    return this.coerce(raw);
  }

  /** List a guild's invites (ManageInvites). */
  async listInvites(guildId: string): Promise<Invite[]> {
    const raw = await firstValueFrom(
      this.http.get<RawInvite[]>(`${this.base}/guilds/${guildId}/invites`),
    );
    return raw.map((r) => this.coerce(r));
  }

  /** Revoke an invite (ManageInvites). */
  deleteInvite(guildId: string, code: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/invites/${code}`),
    );
  }

  /** Preview a code before joining. Throws 404 (invalid) / 410 (expired or used up). */
  preview(code: string): Promise<InvitePreview> {
    return firstValueFrom(this.http.get<InvitePreview>(`${this.base}/invites/${code}`));
  }

  /**
   * Soft preview for inline chat embeds — always resolves 200 with a status instead of
   * throwing, so dead codes in old messages don't log console errors on every render.
   */
  previewEmbed(code: string): Promise<InviteEmbedPreview> {
    return firstValueFrom(
      this.http.get<InviteEmbedPreview>(`${this.base}/invites/${code}/embed`),
    );
  }

  /** Redeem a code and join the guild. Returns the joined guild. */
  join(code: string): Promise<GuildSummary> {
    return firstValueFrom(
      this.http.post<GuildSummary>(`${this.base}/invites/${code}/join`, {}),
    );
  }

  private coerce(r: RawInvite): Invite {
    return {
      ...r,
      createdAt: Number(r.createdAt),
      expiresAt: r.expiresAt === null ? null : Number(r.expiresAt),
    };
  }
}
