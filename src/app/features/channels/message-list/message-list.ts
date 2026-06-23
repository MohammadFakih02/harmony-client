import {
  Component, ElementRef, computed, signal, viewChild, effect, inject, Injector,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { Subscription } from 'rxjs';
import { UiAvatar, MentionAutocomplete } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MemberStore } from '../../../core/stores/member.store';
import { DmStore } from '../../../core/stores/dm.store';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from '../../../core/services/message.service';
import { MessageResponse } from '../../../core/models/message.models';
import { MentionCandidate } from '../../../core/models/member.models';
import { AutofocusEnd } from '../../../shared/directives/autofocus.directive';
import { delayedSignal } from '../../../shared/util/delayed-signal';
import { MentionToken, tokenizeMentions } from '../../../shared/util/mention-tokens';
import { EVERYONE_MENTION_CANDIDATES } from '../../../shared/util/mention-candidates';
import { fuzzyFilter } from '../../../shared/util/fuzzy-match';
import { MentionTrigger, applyMention, detectMentionTrigger } from '../../../shared/util/mention-trigger';
import { MessageAttachments } from '../message-attachments/message-attachments';

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

function formatBannerDate(sentAt: number): string {
  return new Date(sentAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [
    UiAvatar,
    ScrollingModule,
    FormsModule,
    AutofocusEnd,
    MessageAttachments,
    OverlayModule,
    MentionAutocomplete,
  ],
  host: { class: 'flex flex-col min-h-0 h-full relative' },
  templateUrl: './message-list.html',
})
export class MessageList {
  protected readonly messageStore = inject(MessageStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly memberStore = inject(MemberStore);
  private readonly dmStore = inject(DmStore);
  private readonly messageService = inject(MessageService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  // Candidate usernames for mention-chip rendering — guild members, or the DM peer.
  private readonly knownUsernamesLower = computed<Set<string>>(() => {
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      return new Set(this.memberStore.membersOf(guildId).map((m) => m.username.toLowerCase()));
    }
    const channelId = this.messageStore.activeChannelId();
    const dm = channelId ? this.dmStore.peerOf(channelId) : undefined;
    return dm ? new Set([dm.peerUsername.toLowerCase()]) : new Set<string>();
  });

  protected tokensOf(msg: MessageResponse): MentionToken[] {
    return tokenizeMentions(msg.content, this.knownUsernamesLower());
  }

  // Inline-edit state: the messageId being edited and its working draft.
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');

  // @-mention autocomplete inside the inline editor (only one edit box is open at a time,
  // so a single viewChild + trigger signal suffice). Mirrors the composer's behaviour.
  protected readonly editInput = viewChild<ElementRef<HTMLTextAreaElement>>('editInput');
  protected readonly editMentionTrigger = signal<MentionTrigger | null>(null);
  protected readonly editMentionOpen = computed(() => this.editMentionTrigger() !== null);
  protected readonly editMentionHighlightedIndex = signal(0);
  protected readonly editMentionOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  private readonly editMentionPool = computed<MentionCandidate[]>(() => {
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      const members = this.memberStore
        .membersOf(guildId)
        .map((m) => ({ userId: m.userId, username: m.username, avatarKey: m.avatarKey }));
      return [...EVERYONE_MENTION_CANDIDATES, ...members];
    }
    const channelId = this.messageStore.activeChannelId();
    const dm = channelId ? this.dmStore.peerOf(channelId) : undefined;
    return dm
      ? [{ userId: dm.peerId, username: dm.peerUsername, avatarKey: dm.peerAvatarKey }]
      : [];
  });
  protected readonly editMentionCandidates = computed<MentionCandidate[]>(() => {
    const trigger = this.editMentionTrigger();
    if (!trigger) return [];
    return fuzzyFilter(this.editMentionPool(), trigger.query, (c) => c.username).slice(0, 10);
  });

  protected readonly canManageMessages = computed(
    () => this.channelStore.currentCapabilities()?.canManageMessages ?? false,
  );

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

  // -------------------------------------------------------------------------
  // "X new messages" jump banner — driven by the unread count captured when the
  // channel opened (messageStore.unreadOnOpen). The boundary message id isn't on
  // the client, so the first unread is approximated as the last `count` loaded
  // messages (exact enough to jump to where you left off).
  // -------------------------------------------------------------------------
  protected readonly unreadBanner = computed(() => {
    const count = this.messageStore.unreadOnOpen();
    if (count <= 0) return null;
    const msgs = this.messageStore.messages();
    const idx = msgs.length - count;
    const firstUnread = idx >= 0 ? msgs[idx] : msgs[0];
    if (!firstUnread) return null;
    return {
      count,
      // Only show the date when the boundary message is actually loaded.
      since: idx >= 0 ? formatBannerDate(firstUnread.sentAt) : null,
      firstUnreadId: firstUnread.messageId,
    };
  });

  protected jumpToUnread(): void {
    const banner = this.unreadBanner();
    if (!banner) return;
    const gi = this.messageGroups().findIndex((g) =>
      g.messages.some((m) => m.messageId === banner.firstUnreadId),
    );
    if (gi >= 0) this.viewport()?.scrollToIndex(gi, 'smooth');
    this.messageStore.dismissUnreadBanner();
  }

  protected dismissUnreadBanner(): void {
    // Server-side read state was already updated when the channel opened; this just
    // clears the banner.
    this.messageStore.dismissUnreadBanner();
  }

  // -------------------------------------------------------------------------
  // Edit / delete — own messages always; others' deletable with ManageMessages.
  // The authoritative change arrives via the MessageEdited/MessageDeleted broadcast
  // (shell → store), so these just fire the REST call.
  // -------------------------------------------------------------------------

  protected isMine(msg: MessageResponse): boolean {
    return msg.userId === this.auth.currentUser()?.id;
  }

  protected canEdit(msg: MessageResponse): boolean {
    return this.isMine(msg) && !msg.isDeleted && !msg.pending && !msg.failed;
  }

  protected canDelete(msg: MessageResponse): boolean {
    return (
      (this.isMine(msg) || this.canManageMessages()) &&
      !msg.isDeleted && !msg.pending && !msg.failed
    );
  }

  protected startEdit(msg: MessageResponse): void {
    this.editingId.set(msg.messageId);
    this.editDraft.set(msg.content);
    this.editMentionTrigger.set(null);
  }

  /** Starts editing the user's most recent editable message (the composer ArrowUp shortcut). */
  editLastOwnMessage(): void {
    const msgs = this.messageStore.messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (this.canEdit(msgs[i])) {
        this.startEdit(msgs[i]);
        return;
      }
    }
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
    this.editMentionTrigger.set(null);
  }

  protected onEditInput(value: string): void {
    this.editDraft.set(value);
    const el = this.editInput()?.nativeElement;
    const caret = el?.selectionStart ?? value.length;
    this.editMentionTrigger.set(detectMentionTrigger(value, caret));
    this.editMentionHighlightedIndex.set(0);
  }

  protected selectEditMention(candidate: MentionCandidate): void {
    const trigger = this.editMentionTrigger();
    if (!trigger) return;
    const { text, caret } = applyMention(this.editDraft(), trigger, candidate.username);
    this.editDraft.set(text);
    this.editMentionTrigger.set(null);
    queueMicrotask(() => {
      const el = this.editInput()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  protected async saveEdit(msg: MessageResponse): Promise<void> {
    const content = this.editDraft().trim();
    this.cancelEdit();
    if (!content || content === msg.content) return;
    await this.messageService
      .editMessage(msg.guildId, msg.channelId, msg.messageId, content)
      .catch(() => {});
  }

  protected async deleteMsg(msg: MessageResponse): Promise<void> {
    if (!window.confirm('Delete this message?')) return;
    await this.messageService
      .deleteMessage(msg.guildId, msg.channelId, msg.messageId)
      .catch(() => {});
  }

  protected onEditKeydown(event: KeyboardEvent, msg: MessageResponse): void {
    // The mention popup intercepts navigation/commit keys while it's open.
    if (this.editMentionOpen()) {
      const candidates = this.editMentionCandidates();
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.editMentionHighlightedIndex.set(
            candidates.length ? (this.editMentionHighlightedIndex() + 1) % candidates.length : 0,
          );
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.editMentionHighlightedIndex.set(
            candidates.length
              ? (this.editMentionHighlightedIndex() - 1 + candidates.length) % candidates.length
              : 0,
          );
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (candidates.length > 0)
            this.selectEditMention(candidates[this.editMentionHighlightedIndex()]);
          else this.editMentionTrigger.set(null);
          return;
        case 'Escape':
          event.preventDefault();
          this.editMentionTrigger.set(null);
          return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.saveEdit(msg);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
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
