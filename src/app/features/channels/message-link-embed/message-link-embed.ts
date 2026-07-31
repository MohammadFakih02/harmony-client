import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { UiAvatar } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { dmLabel } from '../../../core/models/direct-message.models';
import { MessageLinkRef } from '../../../shared/util/message-links';

/**
 * Inline card for a link to another Harmony message (see {@link extractMessageLinks}). When the
 * target is in the currently-loaded channel it renders a rich preview (author + snippet); otherwise
 * a compact "jump to message in #channel" card. Clicking reuses the same jump path as search —
 * jump-in-place when already in the channel, else park the target and navigate there.
 */
@Component({
  selector: 'app-message-link-embed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  template: `
    <button
      type="button"
      class="mt-1 flex w-full max-w-md items-center gap-3 rounded-lg border-l-4 border-accent bg-surface-2 px-3 py-2 text-left ring-1 ring-border-subtle hover:bg-surface-3 transition-micro"
      (click)="open()"
    >
      @if (resolved(); as r) {
      <ui-avatar [src]="r.avatarKey" [alt]="r.author" size="sm" ringClass="border-surface-2" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1.5">
          <i class="fas fa-reply fa-flip-vertical text-2xs text-faint"></i>
          <span class="truncate text-xs font-semibold text-primary">{{ r.author }}</span>
        </div>
        <p class="truncate text-xs text-muted">{{ r.snippet }}</p>
      </div>
      } @else {
      <i class="fas fa-comment-dots text-faint"></i>
      <div class="min-w-0 flex-1">
        <span class="text-xs font-semibold text-primary">Jump to message</span>
        <p class="truncate text-xs text-faint">in {{ channelLabel() }}</p>
      </div>
      }
      <i class="fas fa-arrow-right text-2xs text-faint"></i>
    </button>
  `,
})
export class MessageLinkEmbed {
  readonly link = input.required<MessageLinkRef>();

  private readonly messageStore = inject(MessageStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly dmStore = inject(DmStore);
  private readonly router = inject(Router);

  /** Rich preview — only possible when the target sits in the currently-loaded channel's window. */
  protected readonly resolved = computed(() => {
    const l = this.link();
    if (this.messageStore.activeChannelId() !== l.channelId) return null;
    const msg = this.messageStore.messages().find((m) => m.messageId === l.messageId);
    if (!msg || msg.isDeleted) return null;
    const snippet = msg.content.replace(/\s+/g, ' ').trim().slice(0, 120) || '(no text)';
    return { author: msg.username, avatarKey: msg.avatarKey, snippet };
  });

  /** Best-effort name of the target channel for the compact card (falls back gracefully). */
  protected readonly channelLabel = computed(() => {
    const l = this.link();
    if (l.guildId) {
      const channel = (this.channelStore.channelsByGuild()[l.guildId] ?? []).find(
        (c) => c.id === l.channelId,
      );
      return channel ? `#${channel.name}` : 'a channel';
    }
    const dm = this.dmStore.find(l.channelId);
    return dm ? dmLabel(dm, (p) => p.username) : 'a conversation';
  });

  protected open(): void {
    const l = this.link();
    if (this.messageStore.activeChannelId() === l.channelId) {
      void this.messageStore.jumpToMessage(l.guildId, l.channelId, l.messageId);
    } else {
      this.messageStore.requestChannelJump(l.guildId, l.channelId, l.messageId);
      void this.router.navigate(
        l.guildId ? ['/app/guilds', l.guildId, 'channels', l.channelId] : ['/app/dm', l.channelId],
      );
    }
  }
}
