import { Component, computed, ElementRef, effect, inject } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { MessageResponse } from '../../../core/models/message.models';

export interface MessageGroup {
  userId: string;
  username: string;
  avatarKey: string | null;
  firstMessageId: string;
  timestamp: string;
  messages: MessageResponse[];
}

const GROUP_BREAK_MS = 5 * 60 * 1000;

function formatMessageTime(sentAt: number): string {
  const d = new Date(sentAt);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yestStart = new Date(dayStart.getTime() - 86_400_000);
  if (d >= dayStart) return `Today at ${time}`;
  if (d >= yestStart) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ` at ${time}`;
}

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [UiAvatar],
  host: { class: 'flex flex-col overflow-y-auto' },
  templateUrl: './message-list.html',
})
export class MessageList {
  protected readonly messageStore = inject(MessageStore);
  private readonly hostRef = inject(ElementRef);

  protected readonly messageGroups = computed<MessageGroup[]>(() => {
    const msgs = this.messageStore.messages();
    const groups: MessageGroup[] = [];

    for (const msg of msgs) {
      const last = groups[groups.length - 1];
      const lastMsg = last?.messages[last.messages.length - 1];
      const gap = lastMsg ? msg.sentAt - lastMsg.sentAt : Infinity;
      const sameUser = last && last.userId === msg.userId && !msg.failed;

      if (sameUser && gap < GROUP_BREAK_MS) {
        last.messages.push(msg);
      } else {
        groups.push({
          userId: msg.userId ?? '',
          username: msg.username ?? 'Unknown',
          avatarKey: msg.avatarKey ?? null,
          firstMessageId: msg.messageId,
          timestamp: formatMessageTime(msg.sentAt),
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
        const el = this.hostRef.nativeElement as HTMLElement;
        el.scrollTop = el.scrollHeight;
      }, 0);
    });
  }
}
