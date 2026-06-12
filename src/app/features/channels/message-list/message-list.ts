import { Component, computed, ElementRef, effect, inject, ViewChild } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { MessageResponse } from '../../../core/models/message.models';

export interface MessageGroup {
  userId: number;
  username: string;
  avatarKey: string | null;
  firstMessageId: number;
  timestamp: string;
  messages: MessageResponse[];
}

const GROUP_BREAK_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [UiAvatar],
  templateUrl: './message-list.html',
})
export class MessageList {
  protected readonly messageStore = inject(MessageStore);

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLDivElement>;

  protected readonly messageGroups = computed<MessageGroup[]>(() => {
    const msgs = this.messageStore.messages();
    const groups: MessageGroup[] = [];

    for (const msg of msgs) {
      const last = groups[groups.length - 1];
      const lastMsg = last?.messages[last.messages.length - 1];
      const gap = lastMsg
        ? new Date(msg.createdAt).getTime() - new Date(lastMsg.createdAt).getTime()
        : Infinity;
      const sameUser = last && last.userId === msg.userId && !msg.failed;

      if (sameUser && gap < GROUP_BREAK_MS) {
        last.messages.push(msg);
      } else {
        groups.push({
          userId: msg.userId ?? 0,
          username: msg.username ?? 'Unknown',
          avatarKey: msg.avatarKey ?? null,
          firstMessageId: msg.messageId,
          timestamp: new Date(msg.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          messages: [msg],
        });
      }
    }

    return groups;
  });

  constructor() {
    // Scroll to bottom whenever message count changes
    effect(() => {
      const count = this.messageStore.messages().length;
      if (count === 0) return;
      setTimeout(() => {
        const el = this.scrollContainer?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    });
  }
}
