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
    guildId: string,
    channelId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<ChannelMessagesResponse> {
    const params: Record<string, string> = { limit: String(options.limit ?? 50) };
    if (options.before != null) params['before'] = options.before;
    return firstValueFrom(
      this.http.get<ChannelMessagesResponse>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/messages`,
        { params },
      ),
    );
  }

  sendMessage(
    guildId: string,
    channelId: string,
    content: string,
    options: { attachmentIds?: string[]; replyToId?: string } = {},
  ): Promise<SendMessageResponse> {
    return firstValueFrom(
      this.http.post<SendMessageResponse>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/messages`,
        { content, ...options },
      ),
    );
  }

  editMessage(
    guildId: string,
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    return firstValueFrom(
      this.http.patch<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/messages/${messageId}`,
        { content },
      ),
    );
  }

  deleteMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.base}/guilds/${guildId}/channels/${channelId}/messages/${messageId}`,
      ),
    );
  }

  markRead(guildId: string, channelId: string, lastReadMessageId: string): Promise<void> {
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
