import {
  Component, computed, viewChild, effect, inject, Injector,
} from '@angular/core';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Subscription } from 'rxjs';
import { UiAvatar } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { AuthService } from '../../../core/services/auth.service';
import { MessageResponse } from '../../../core/models/message.models';
import { delayedSignal } from '../../../shared/util/delayed-signal';

export interface MessageGroup {
  userId: string;
  username: string;
  avatarKey: string | null;
  firstMessageId: string;
  timestamp: string;
  messages: MessageResponse[];
}

const GROUP_BREAK_MS = 5 * 60 * 1000;
const LOAD_OLDER_THRESHOLD_PX = 100;

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
  imports: [UiAvatar, ScrollingModule],
  host: { class: 'flex flex-col min-h-0 h-full' },
  templateUrl: './message-list.html',
})
export class MessageList {
  protected readonly messageStore = inject(MessageStore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  // Only surface the initial-load spinner if the fetch takes longer than ~200ms,
  // so fast channel switches don't flash it.
  protected readonly showInitialLoading = delayedSignal(
    computed(() => this.messageStore.isLoading() && this.messageStore.messages().length === 0),
  );

  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  private scrollSub = new Subscription();
  private prevCount = 0;
  private prevTailSignature = '';
  private isInitialLoad = true;
  private atBottom = true;

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

  protected trackGroup(_: number, g: MessageGroup): string {
    return g.firstMessageId;
  }

  constructor() {
    // Wire scroll listener whenever the viewport enters/leaves the DOM
    effect(() => {
      const vp = this.viewport();
      this.scrollSub.unsubscribe();
      this.scrollSub = new Subscription();
      if (!vp) return;

      this.scrollSub.add(
        vp.elementScrolled().subscribe(() => {
          const el = vp.elementRef.nativeElement as HTMLElement;
          this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

          if (
            el.scrollTop < LOAD_OLDER_THRESHOLD_PX &&
            this.messageStore.hasMore() &&
            !this.messageStore.isLoading()
          ) {
            this.messageStore.loadOlder();
          }
        }),
      );

      // Initial scroll once the viewport exists
      vp.checkViewportSize();
      this.scrollToBottom();
    });

    // React to message list changes
    effect(
      () => {
        const msgs = this.messageStore.messages();
        const last = msgs[msgs.length - 1];

        // Signature changes when a message is added/removed OR the tail message's
        // optimistic state flips (e.g. my pending message transitions to failed,
        // which also re-groups it and would otherwise jump the viewport).
        const signature = `${msgs.length}|${last?.messageId ?? ''}|${last?.pending ?? false}|${last?.failed ?? false}`;
        if (signature === this.prevTailSignature) return;
        const grew = msgs.length > this.prevCount;
        this.prevTailSignature = signature;
        this.prevCount = msgs.length;

        if (!last) return;

        const myId = this.auth.currentUser()?.id;
        // "Mine" includes optimistic states so a send — or a send that fails —
        // keeps the message (and its Retry button) in view at the bottom.
        const isMine = last.userId === myId || last.pending === true || last.failed === true;

        // Initial load OR my own message OR a new message while already at the bottom
        // → pin to bottom. (Loading older history scrolls from the top, must NOT yank.)
        if (this.isInitialLoad || isMine || (grew && this.atBottom)) {
          this.isInitialLoad = false;
          this.scrollToBottom();
        }
      },
      { injector: this.injector },
    );
  }

  private scrollToBottom(): void {
    const vp = this.viewport();
    if (!vp) return;
    const el = vp.elementRef.nativeElement as HTMLElement;
    // Two rAFs: first lets Angular render the *cdkVirtualFor items, the second
    // lets CDK apply its content-wrapper transform + total-size spacer. Only
    // then does el.scrollHeight reflect the real bottom. Native scrollTop is
    // used (not scrollToIndex) because itemSize is an estimate and our message
    // groups have variable height — index math can't reach the true bottom.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      }),
    );
  }
}
