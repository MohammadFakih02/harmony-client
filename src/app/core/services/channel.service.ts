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

  createChannel(guildId: string, name: string, type: 'text' | 'voice'): Promise<Channel> {
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
}
