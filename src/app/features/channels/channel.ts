import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  template: `
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-y-auto">
        <app-message-list />
      </div>
      <app-message-input />
    </div>
  `,
})
export class Channel implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly signalR = inject(SignalRService);

  private channelId = 0;
  private guildId = 0;

  async ngOnInit(): Promise<void> {
    this.channelId = Number(this.route.snapshot.params['channelId']);
    this.guildId = Number(this.route.snapshot.parent?.params['guildId']);

    this.channelStore.selectChannel(this.channelId);
    await this.messageStore.loadMessages(this.guildId, this.channelId);

    // Mark as read using the newest loaded message
    const messages = this.messageStore.messages();
    const newest = [...messages].reverse().find((m: MessageResponse) => (m.messageId ?? 0) > 0);
    if (newest) {
      this.unreadStore.markRead(this.guildId, this.channelId, newest.messageId).catch(() => {});
    }

    await this.signalR.client?.joinChannel(this.channelId).catch(() => {});
  }

  async ngOnDestroy(): Promise<void> {
    await this.signalR.client?.leaveChannel(this.channelId).catch(() => {});
    this.messageStore.clearMessages();
  }
}
