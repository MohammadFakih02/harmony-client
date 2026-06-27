import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildBan, GuildCapabilities, GuildMember } from '../models/member.models';

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  async getMembers(guildId: string): Promise<GuildMember[]> {
    const raw = await firstValueFrom(
      this.http.get<GuildMember[]>(`${this.base}/guilds/${guildId}/members`),
    );
    // joinedAt / communicationDisabledUntil are longs serialized as strings (LongStringConverter).
    return raw.map((m) => ({
      ...m,
      joinedAt: Number(m.joinedAt),
      communicationDisabledUntil:
        m.communicationDisabledUntil == null ? null : Number(m.communicationDisabledUntil),
      roleIds: (m.roleIds ?? []).map(String),
    }));
  }

  getCapabilities(guildId: string): Promise<GuildCapabilities> {
    return firstValueFrom(
      this.http.get<GuildCapabilities>(`${this.base}/guilds/${guildId}/permissions`),
    );
  }

  /** Member ids that can ViewChannel the given channel (longs come back as strings). */
  async getChannelViewers(guildId: string, channelId: string): Promise<string[]> {
    const raw = await firstValueFrom(
      this.http.get<string[]>(`${this.base}/guilds/${guildId}/channels/${channelId}/viewers`),
    );
    return raw.map(String);
  }

  async getBans(guildId: string): Promise<GuildBan[]> {
    const raw = await firstValueFrom(
      this.http.get<GuildBan[]>(`${this.base}/guilds/${guildId}/members/bans`),
    );
    return raw.map((b) => ({ ...b, createdAt: Number(b.createdAt) }));
  }

  kick(guildId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/members/${userId}`),
    );
  }

  ban(guildId: string, userId: string, reason: string | null): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.base}/guilds/${guildId}/members/bans/${userId}`, { reason }),
    );
  }

  unban(guildId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/members/bans/${userId}`),
    );
  }

  timeout(guildId: string, userId: string, durationSeconds: number): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.base}/guilds/${guildId}/members/${userId}/timeout`, {
        durationSeconds,
      }),
    );
  }

  clearTimeout(guildId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/members/${userId}/timeout`),
    );
  }
}
