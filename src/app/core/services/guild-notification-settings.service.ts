import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildNotificationSettings, NotificationLevel } from '../models/notification-setting.models';

@Injectable({ providedIn: 'root' })
export class GuildNotificationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  get(guildId: string): Promise<GuildNotificationSettings> {
    return firstValueFrom(
      this.http.get<GuildNotificationSettings>(
        `${this.base}/guilds/${guildId}/notification-settings`,
      ),
    );
  }

  setGuildLevel(guildId: string, level: NotificationLevel): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.base}/guilds/${guildId}/notification-settings`, { level }),
    );
  }

  resetGuildLevel(guildId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/guilds/${guildId}/notification-settings`),
    );
  }

  setGuildSuppressEveryone(guildId: string, value: boolean): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(
        `${this.base}/guilds/${guildId}/notification-settings/suppress-everyone`,
        { value },
      ),
    );
  }

  setChannelSuppressEveryone(guildId: string, channelId: string, value: boolean): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/notification-settings/suppress-everyone`,
        { value },
      ),
    );
  }

  setChannelLevel(guildId: string, channelId: string, level: NotificationLevel): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/notification-settings`,
        { level },
      ),
    );
  }

  resetChannelLevel(guildId: string, channelId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/notification-settings`,
      ),
    );
  }
}
