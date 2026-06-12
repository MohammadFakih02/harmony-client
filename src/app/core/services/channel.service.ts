import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Channel } from '../models/channel.models';

@Injectable({ providedIn: 'root' })
export class ChannelService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getGuildChannels(guildId: number): Promise<Channel[]> {
    return firstValueFrom(this.http.get<Channel[]>(`${this.base}/guilds/${guildId}/channels`));
  }
}
