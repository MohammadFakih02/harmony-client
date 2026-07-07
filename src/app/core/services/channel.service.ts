import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Channel, ChannelCapabilities } from '../models/channel.models';

@Injectable({ providedIn: 'root' })
export class ChannelService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getGuildChannels(guildId: string): Promise<Channel[]> {
    return firstValueFrom(this.http.get<Channel[]>(`${this.base}/guilds/${guildId}/channels`));
  }

  getCapabilities(guildId: string, channelId: string): Promise<ChannelCapabilities> {
    return firstValueFrom(
      this.http.get<ChannelCapabilities>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/permissions`,
      ),
    );
  }

  /** Persist new channel positions (ManageChannels). Returns the guild's full sorted list. */
  reorder(
    guildId: string,
    updates: { channelId: string; position: number }[],
  ): Promise<Channel[]> {
    return firstValueFrom(
      this.http.patch<Channel[]>(`${this.base}/guilds/${guildId}/channels/reorder`, updates),
    );
  }

  /** Partial channel update (ManageChannels) — name/topic/NSFW/slowmode. */
  update(
    guildId: string,
    channelId: string,
    patch: { name?: string; topic?: string | null; isNsfw?: boolean; slowmodeSeconds?: number },
  ): Promise<Channel> {
    return firstValueFrom(
      this.http.patch<Channel>(`${this.base}/guilds/${guildId}/channels/${channelId}`, patch),
    );
  }

  delete(guildId: string, channelId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/channels/${channelId}`),
    );
  }

  createChannel(
    guildId: string,
    name: string,
    type: 'text' | 'voice' | 'category',
  ): Promise<Channel> {
    return firstValueFrom(
      this.http.post<Channel>(`${this.base}/guilds/${guildId}/channels`, {
        name,
        type,
        topic: null,
        position: 0,
        categoryId: null,
        isNsfw: false,
        slowmodeSeconds: 0,
      }),
    );
  }

  /** Moves a channel into a category, or clears it (categoryId null = top-level). */
  moveToCategory(guildId: string, channelId: string, categoryId: string | null): Promise<Channel> {
    return firstValueFrom(
      this.http.patch<Channel>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/category`,
        { categoryId },
      ),
    );
  }
}
