import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChannelMessagesResponse,
  SendMessageResponse,
  UnreadCountResponse,
} from '../models/message.models';

@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getMessages(
    channelId: number,
    options: { before?: number; limit?: number } = {},
  ): Promise<ChannelMessagesResponse> {
    const params: Record<string, string> = { limit: String(options.limit ?? 50) };
    if (options.before != null) params['before'] = String(options.before);
    return firstValueFrom(
      this.http.get<ChannelMessagesResponse>(`${this.base}/channels/${channelId}/messages`, {
        params,
      }),
    );
  }

  sendMessage(
    guildId: number,
    channelId: number,
    content: string,
    options: { attachmentId?: number; replyToId?: number } = {},
  ): Promise<SendMessageResponse> {
    return firstValueFrom(
      this.http.post<SendMessageResponse>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/messages`,
        { content, ...options },
      ),
    );
  }

  markRead(guildId: number, channelId: number, lastReadMessageId: number): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/read`,
        { lastReadMessageId },
      ),
    );
  }

  getUnreadCounts(): Promise<UnreadCountResponse[]> {
    return firstValueFrom(
      this.http.get<UnreadCountResponse[]>(`${this.base}/users/me/unread`),
    );
  }
}
