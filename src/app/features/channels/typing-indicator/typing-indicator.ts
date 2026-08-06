import { Component, computed, inject } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { TypingStore } from '../../../core/stores/typing.store';
import { MessageStore } from '../../../core/stores/message.store';
import { MemberStore } from '../../../core/stores/member.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { BlockStore } from '../../../core/stores/block.store';
import { MuteStore } from '../../../core/stores/mute.store';

/**
 * "X is typing…" bar for the active channel. Resolves each typing user's display name from the
 * client's own stores — server nickname in a guild, friend nickname in a DM (same precedence as the
 * rest of the UI) — so no username needs to travel with the typing signal. Renders nothing when
 * nobody is typing (no reserved space).
 */
@Component({
  selector: 'app-typing-indicator',
  standalone: true,
  imports: [UiAvatar],
  host: { class: 'block' },
  template: `
    @if (label(); as text) {
      <div class="flex items-center gap-2 px-4 h-6 text-xs text-muted bg-surface">
        <span class="flex -space-x-1.5" aria-hidden="true">
          @for (t of typers().slice(0, 3); track t.userId) {
          <ui-avatar [src]="t.avatarKey" [alt]="t.name" size="sm" ringClass="border-surface" />
          }
        </span>
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
  private readonly blockStore = inject(BlockStore);
  private readonly muteStore = inject(MuteStore);

  /** The (unblocked, unmuted) users currently typing here, with their display name + avatar. */
  protected readonly typers = computed<{ userId: string; name: string; avatarKey: string | null }[]>(
    () => {
      const channelId = this.messageStore.activeChannelId();
      if (!channelId) return [];
      const guildId = this.messageStore.activeGuildId();
      // Blocked AND user-muted typers are hidden — a user mute suppresses their activity signals
      // (flow #22), while their messages stay visible (unlike a block).
      const blocked = this.blockStore.blockedIds();
      const muted = this.muteStore.mutedUserIds();
      return this.typingStore
        .typersOf(channelId)
        .filter((userId) => !blocked.has(userId) && !muted.has(userId))
        .map((userId) => ({
          userId,
          name: this.displayName(userId, guildId),
          avatarKey: this.avatarOf(userId, guildId),
        }));
    },
  );

  private readonly names = computed<string[]>(() => this.typers().map((t) => t.name));

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

  /** Avatar key for a typing user — guild member record in a guild, DM participant otherwise. */
  private avatarOf(userId: string, guildId: string | null): string | null {
    if (guildId) {
      return this.memberStore.membersOf(guildId).find((m) => m.userId === userId)?.avatarKey ?? null;
    }
    const channelId = this.messageStore.activeChannelId();
    const peer = channelId
      ? this.dmStore.find(channelId)?.participants.find((p) => p.userId === userId)
      : undefined;
    return peer?.avatarKey ?? null;
  }
}
