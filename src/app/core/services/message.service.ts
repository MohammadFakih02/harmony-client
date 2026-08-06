import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChannelMessagesResponse,
  PinnedMessageResponse,
  SendMessageResponse,
  UnreadCountResponse,
} from '../models/message.models';

@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /**
   * Base URL for a channel's message surface. A guild channel nests under its guild;
   * a DM (guildId null) lives under /dm/{channelId}. Both expose the same
   * messages / read endpoints, so every method below just builds on this.
   */
  private channelBase(guildId: string | null, channelId: string): string {
    return guildId == null
      ? `${this.base}/dm/${channelId}`
      : `${this.base}/guilds/${guildId}/channels/${channelId}`;
  }

  getMessages(
    guildId: string | null,
    channelId: string,
    options: { before?: string; around?: string; after?: string; limit?: number } = {},
  ): Promise<ChannelMessagesResponse> {
    const params: Record<string, string> = { limit: String(options.limit ?? 50) };
    // Mutually exclusive cursors: before = older page, after = newer page, around = window centred
    // on a jump target (search result / reply reference).
    if (options.before != null) params['before'] = options.before;
    if (options.after != null) params['after'] = options.after;
    if (options.around != null) params['around'] = options.around;
    return firstValueFrom(
      this.http.get<ChannelMessagesResponse>(
        `${this.channelBase(guildId, channelId)}/messages`,
        { params },
      ),
    );
  }

  sendMessage(
    guildId: string | null,
    channelId: string,
    content: string,
    options: { attachmentIds?: string[]; replyToId?: string; nonce?: string } = {},
  ): Promise<SendMessageResponse> {
    return firstValueFrom(
      this.http.post<SendMessageResponse>(
        `${this.channelBase(guildId, channelId)}/messages`,
        { content, ...options },
      ),
    );
  }

  /**
   * Forwards an existing message into `channelId`. Sends only *references* (source channel +
   * message) plus an optional note and any re-uploaded attachment ids — the server reads the
   * original, verifies the forwarder can see it, and builds the authoritative snapshot. Returns
   * the ack; the forwarded message (with its snapshot) arrives on the MessageReceived broadcast.
   */
  forwardMessage(
    guildId: string | null,
    channelId: string,
    source: { sourceChannelId: string; sourceMessageId: string },
    options: { note?: string; attachmentIds?: string[] } = {},
  ): Promise<SendMessageResponse> {
    return firstValueFrom(
      this.http.post<SendMessageResponse>(
        `${this.channelBase(guildId, channelId)}/messages/forward`,
        { ...source, ...options },
      ),
    );
  }

  editMessage(
    guildId: string | null,
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    return firstValueFrom(
      this.http.patch<void>(
        `${this.channelBase(guildId, channelId)}/messages/${messageId}`,
        { content },
      ),
    );
  }

  deleteMessage(guildId: string | null, channelId: string, messageId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.channelBase(guildId, channelId)}/messages/${messageId}`,
      ),
    );
  }

  getPins(guildId: string | null, channelId: string): Promise<PinnedMessageResponse[]> {
    return firstValueFrom(
      this.http.get<PinnedMessageResponse[]>(`${this.channelBase(guildId, channelId)}/pins`),
    );
  }

  pinMessage(guildId: string | null, channelId: string, messageId: string): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.channelBase(guildId, channelId)}/pins/${messageId}`, {}),
    );
  }

  unpinMessage(guildId: string | null, channelId: string, messageId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.channelBase(guildId, channelId)}/pins/${messageId}`),
    );
  }

  markRead(guildId: string | null, channelId: string, lastReadMessageId: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.channelBase(guildId, channelId)}/read`, { lastReadMessageId }),
    );
  }

  getUnreadCounts(): Promise<UnreadCountResponse[]> {
    return firstValueFrom(
      this.http.get<UnreadCountResponse[]>(`${this.base}/users/me/unread`),
    );
  }
}
