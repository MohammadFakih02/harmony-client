import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { MessageResponse } from '../../core/models/message.models';
import { ChannelStore } from '../../core/stores/channel.store';
import { MessageStore } from '../../core/stores/message.store';
import { SignalRService } from '../../core/services/signalr.service';
import { UnreadStore } from '../../core/stores/unread.store';
import { MessageList } from './message-list/message-list';
import { MessageInput } from './message-input/message-input';

@Component({
  selector: 'app-channel',
  standalone: true,
  imports: [MessageList, MessageInput],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  template: `
    <app-message-list #list class="flex-1 min-h-0" />
    <app-message-input (editLastRequested)="list.editLastOwnMessage()" />
  `,
})
export class Channel implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly signalR = inject(SignalRService);

  private channelId = '';
  // null = a DM (no owning guild). Guild channels carry their guild id here.
  private guildId: string | null = null;
  private paramSub?: Subscription;

  ngOnInit(): void {
    this.paramSub = this.route.params.subscribe(async (params) => {
      const newChannelId: string = params['channelId'];
      // The guild id only exists on the guild route's parent; a DM route has none.
      const newGuildId: string | null = this.route.snapshot.parent?.params['guildId'] ?? null;
      if (newChannelId === this.channelId) return;

      const prev = this.channelId;
      this.channelId = newChannelId;
      this.guildId = newGuildId;

      // Capture the unread count BEFORE mark-read resets it — drives the jump banner.
      const unreadOnOpen = this.unreadStore.counts()[newChannelId] ?? 0;

      this.channelStore.selectChannel(newChannelId);
      if (newGuildId) {
        // Guild-only concerns: last-visited memory + channel capability resolution.
        this.channelStore.rememberChannel(newGuildId, newChannelId);
        this.channelStore.loadCapabilities(newGuildId, newChannelId);
      }
      await this.messageStore.loadMessages(newGuildId, newChannelId);
      this.messageStore.setUnreadOnOpen(unreadOnOpen);
      // Highlight the unread mentions of me in this view (clears on leave/rejoin).
      this.messageStore.seedMentionHighlights();

      const messages = this.messageStore.messages();
      const newest = [...messages].reverse().find((m: MessageResponse) => !m.tempId);
      if (newest) {
        this.unreadStore.markRead(newGuildId, newChannelId, newest.messageId).catch(() => {});
      }

      // Route through the service so the join is recorded as "desired" and applied once the socket
      // is live — a deep-link refresh activates this before the connection handshake completes, and
      // a blind client?.joinChannel() would be silently dropped (no live messages until you switch).
      if (prev) void this.signalR.leaveChannel(prev);
      void this.signalR.joinChannel(newChannelId);
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    void this.signalR.leaveChannel(this.channelId);
    this.messageStore.clearMessages();
  }
}
