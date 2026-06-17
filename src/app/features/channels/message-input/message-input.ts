import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MessageStore } from '../../../core/stores/message.store';
import { AutoGrow } from '../../../shared/directives/auto-grow.directive';

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [FormsModule, AutoGrow],
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

  // Whether the caller may send here at all (permission + not timed-out). Defaults to
  // true while capabilities are still loading so normal users aren't briefly blocked;
  // the server enforces regardless.
  protected readonly canSendInChannel = computed(
    () => this.channelStore.currentCapabilities()?.canSend ?? true,
  );

  // Explains a disabled input — timeout vs missing permission.
  protected readonly disabledReason = computed(() => {
    const caps = this.channelStore.currentCapabilities();
    if (!caps || caps.canSend) return null;
    return caps.timedOut
      ? "You're timed out and can't send messages."
      : 'You do not have permission to send messages in this channel.';
  });

  protected readonly canSend = computed(
    () => this.draft().trim().length > 0 && !this.sending() && this.canSendInChannel(),
  );

  async send(): Promise<void> {
    const content = this.draft().trim();
    if (!content || this.sending() || !this.canSendInChannel()) return;
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
