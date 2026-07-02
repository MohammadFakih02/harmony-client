import { Component, computed, inject } from '@angular/core';
import { TypingStore } from '../../../core/stores/typing.store';
import { MessageStore } from '../../../core/stores/message.store';
import { MemberStore } from '../../../core/stores/member.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';

/**
 * "X is typing…" bar for the active channel. Resolves each typing user's display name from the
 * client's own stores — server nickname in a guild, friend nickname in a DM (same precedence as the
 * rest of the UI) — so no username needs to travel with the typing signal. Renders nothing when
 * nobody is typing (no reserved space).
 */
@Component({
  selector: 'app-typing-indicator',
  standalone: true,
  host: { class: 'block' },
  template: `
    @if (label(); as text) {
      <div class="flex items-center gap-2 px-4 h-6 text-xs text-muted">
        <span class="inline-flex gap-0.5" aria-hidden="true">
          <span class="w-1 h-1 rounded-full bg-muted animate-bounce [animation-delay:-0.2s]"></span>
          <span class="w-1 h-1 rounded-full bg-muted animate-bounce [animation-delay:-0.1s]"></span>
          <span class="w-1 h-1 rounded-full bg-muted animate-bounce"></span>
        </span>
        <span class="truncate">{{ text }}</span>
      </div>
    }
  `,
})
export class TypingIndicator {
  private readonly typingStore = inject(TypingStore);
  private readonly messageStore = inject(MessageStore);
  private readonly memberStore = inject(MemberStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);

  private readonly names = computed<string[]>(() => {
    const channelId = this.messageStore.activeChannelId();
    if (!channelId) return [];
    const guildId = this.messageStore.activeGuildId();
    return this.typingStore.typersOf(channelId).map((userId) => this.displayName(userId, guildId));
  });

  /** The "… is/are typing" sentence, or null when nobody's typing. */
  protected readonly label = computed<string | null>(() => {
    const n = this.names();
    if (n.length === 0) return null;
    if (n.length === 1) return `${n[0]} is typing…`;
    if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`;
    if (n.length === 3) return `${n[0]}, ${n[1]}, and ${n[2]} are typing…`;
    return 'Several people are typing…';
  });

  /** Display name: guild → server nickname ?? username; DM → friend nickname ?? username. */
  private displayName(userId: string, guildId: string | null): string {
    if (guildId) {
      const member = this.memberStore.membersOf(guildId).find((m) => m.userId === userId);
      return member?.nickname ?? member?.username ?? 'Someone';
    }
    const channelId = this.messageStore.activeChannelId();
    const peer = channelId
      ? this.dmStore.find(channelId)?.participants.find((p) => p.userId === userId)
      : undefined;
    return this.nicknameStore.nicknameOf(userId) ?? peer?.username ?? 'Someone';
  }
}
