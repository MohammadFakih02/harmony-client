import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MessageStore } from '../../../core/stores/message.store';

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './message-input.html',
})
export class MessageInput {
  protected readonly channelStore = inject(ChannelStore);
  protected readonly messageStore = inject(MessageStore);

  protected readonly draft = signal('');
  protected readonly sending = signal(false);

  protected readonly channelName = computed(
    () => this.channelStore.selectedChannel()?.name ?? 'channel',
  );

  protected readonly canSend = computed(
    () => this.draft().trim().length > 0 && !this.sending(),
  );

  async send(): Promise<void> {
    const content = this.draft().trim();
    if (!content || this.sending()) return;
    this.sending.set(true);
    this.draft.set('');
    try {
      await this.messageStore.sendMessage(content);
    } finally {
      this.sending.set(false);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }
}
