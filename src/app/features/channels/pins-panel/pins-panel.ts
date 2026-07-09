import { Component, computed, inject, output } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { PinStore } from '../../../core/stores/pin.store';
import { MessageStore } from '../../../core/stores/message.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MemberStore } from '../../../core/stores/member.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { PinnedMessageResponse } from '../../../core/models/message.models';

/**
 * The channel's pinned-message panel, opened from the header pin button (as a CDK overlay). Lists
 * pins newest-first with Jump (anchored history load via MessageStore.jumpToMessage, so pins outside
 * the loaded window still land) and Unpin (gated the same way as the message-list pin action).
 * Reads everything from PinStore — the header only toggles its visibility.
 */
@Component({
  selector: 'app-pins-panel',
  standalone: true,
  imports: [UiAvatar],
  template: `
    <div
      class="w-96 max-w-[90vw] rounded-lg bg-surface ring-1 ring-border-subtle shadow-lg overflow-hidden"
    >
      <div class="flex items-center gap-2 px-3.5 h-11 border-b border-border-subtle">
        <i class="fas fa-thumbtack text-faint text-sm"></i>
        <span class="text-sm font-semibold text-primary">Pinned Messages</span>
        <div class="flex-1"></div>
        <button
          class="w-7 h-7 flex items-center justify-center rounded-md text-faint hover:text-primary hover:bg-surface-2 transition-micro"
          title="Close"
          (click)="close.emit()"
        >
          <i class="fas fa-xmark text-sm"></i>
        </button>
      </div>

      <div class="max-h-96 overflow-y-auto">
        @if (pinStore.pins().length === 0) {
        <div class="flex flex-col items-center justify-center gap-2 py-10 text-center px-6">
          <i class="fas fa-thumbtack text-3xl text-faint"></i>
          <p class="text-sm text-muted">No pinned messages yet.</p>
        </div>
        } @else {
        @for (pin of pinStore.pins(); track pin.message.messageId) {
        <div class="group flex items-start gap-2.5 px-3.5 py-2.5 border-b border-border-subtle/60 hover:bg-surface-2 transition-micro">
          <ui-avatar [src]="pin.message.avatarKey" [alt]="pin.message.username" size="sm" class="mt-0.5 shrink-0" />
          <div class="flex flex-col gap-0.5 flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-semibold text-primary truncate">{{ displayName(pin) }}</span>
              <span class="text-2xs text-faint shrink-0">{{ formatDate(pin.message.sentAt) }}</span>
            </div>
            <p class="text-sm text-muted wrap-break-words line-clamp-3">
              {{ preview(pin) }}
            </p>
            <div class="flex items-center gap-3 mt-1">
              <button
                class="text-2xs font-medium text-accent hover:underline"
                (click)="jump(pin)"
              >
                Jump
              </button>
              @if (canPin()) {
              <button
                class="text-2xs font-medium text-faint hover:text-danger transition-micro"
                (click)="unpin(pin)"
              >
                Unpin
              </button>
              }
            </div>
          </div>
        </div>
        }
        }
      </div>
    </div>
  `,
})
export class PinsPanel {
  protected readonly pinStore = inject(PinStore);
  private readonly messageStore = inject(MessageStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly memberStore = inject(MemberStore);
  private readonly nicknameStore = inject(NicknameStore);

  readonly close = output<void>();

  /** Nickname-aware author name (guild server-nickname, else DM friend-nickname), like the message list. */
  protected displayName(pin: PinnedMessageResponse): string {
    const userId = pin.message.userId;
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      const member = this.memberStore.membersOf(guildId).find((m) => m.userId === userId);
      return member?.nickname ?? pin.message.username;
    }
    return this.nicknameStore.nicknameOf(userId) ?? pin.message.username;
  }

  /** Same rule as the message list: guild → PinMessages capability; DM → always (a participant). */
  protected readonly canPin = computed(() =>
    this.messageStore.activeGuildId()
      ? (this.channelStore.currentCapabilities()?.canPin ?? false)
      : true,
  );

  protected preview(pin: PinnedMessageResponse): string {
    const content = pin.message.content?.trim();
    if (content) return content;
    return pin.message.attachmentIds.length ? '📎 Attachment' : '';
  }

  protected formatDate(sentAt: number): string {
    return new Date(sentAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  protected jump(pin: PinnedMessageResponse): void {
    // Anchored jump (loads a window centred on the pin) so pins outside the loaded window still land,
    // unlike requestJump which only scrolls to an already-rendered message.
    void this.messageStore.jumpToMessage(
      this.messageStore.activeGuildId(),
      pin.message.channelId,
      pin.message.messageId,
    );
    this.close.emit();
  }

  protected unpin(pin: PinnedMessageResponse): void {
    void this.pinStore.unpin(pin.message.guildId, pin.message.channelId, pin.message.messageId);
  }
}
