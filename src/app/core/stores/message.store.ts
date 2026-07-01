import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { MessageFailedPayload, MessageResponse, ReplyTarget } from '../models/message.models';
import { AuthService } from '../services/auth.service';
import { MessageService } from '../services/message.service';

let _tempIdCounter = -1;
const nextTempId = (): number => _tempIdCounter--;

// The message list renders in a plain scroll container (no virtualization), so the loaded window
// is bounded to keep the DOM cheap: while pinned to the bottom, older off-screen messages beyond
// this many are trimmed (re-fetchable on scroll-up). Sized well above a screen's worth of history.
const MESSAGE_WINDOW_CAP = 200;

interface MessageState {
  messages: MessageResponse[];
  isLoading: boolean;
  hasMore: boolean;
  degraded: boolean;
  activeChannelId: string | null;
  activeGuildId: string | null;
  // Unread count captured when the channel was opened (before mark-read resets it) —
  // drives the "X new messages" jump banner. 0 = no banner.
  unreadOnOpen: number;
  // Maps server messageId (string) → local tempId (number)
  realIdToTempId: Record<string, number>;
  // Message ids highlighted as unseen mentions of the current user. Session-scoped: seeded from
  // the unread block on open, extended by live mentions, and reset when the channel changes
  // (leave/rejoin). Deliberately NOT cleared by a later message arriving.
  mentionHighlights: Record<string, true>;
  // The message being replied to, shared between the message list (where Reply is clicked) and
  // the composer (which shows the banner + sends replyToId). Cleared on send and channel change.
  replyTarget: ReplyTarget | null;
  // A request to scroll to + highlight a message (e.g. from the pins panel's Jump). The nonce
  // makes repeated jumps to the same id re-trigger the message-list effect. Null = no pending jump.
  jumpRequest: { messageId: string; nonce: number } | null;
}

let _jumpNonce = 0;

export const MessageStore = signalStore(
  { providedIn: 'root' },
  withState<MessageState>({
    messages: [],
    isLoading: false,
    hasMore: true,
    degraded: false,
    activeChannelId: null,
    activeGuildId: null,
    unreadOnOpen: 0,
    realIdToTempId: {},
    mentionHighlights: {},
    replyTarget: null,
    jumpRequest: null,
  }),
  withMethods((store, service = inject(MessageService), auth = inject(AuthService)) => {
    /**
     * Reconcile an optimistic message with its server id once the POST resolves.
     * Under high latency the SignalR `MessageReceived` broadcast can arrive *before*
     * this POST returns — in that case `appendMessage` has already inserted the
     * authoritative copy, so we drop the optimistic ghost instead of relabeling it
     * (which would leave two copies of the same id, one stuck `pending`).
     * Closure over `store` so it works regardless of `this` binding after `await`.
     */
    const confirmSent = (tempId: number, realId: string): void => {
      const alreadyArrived = store.messages().some((m) => m.messageId === realId);
      if (alreadyArrived) {
        // SignalR's MessageReceived already inserted the authoritative copy →
        // drop the optimistic ghost so we don't keep two copies of the same id.
        patchState(store, {
          messages: store.messages().filter((m) => m.tempId !== tempId),
        });
      } else {
        // A successful POST means the server accepted the message, so it's no
        // longer "pending" — clear it now rather than waiting for the SignalR
        // echo (which may be delayed/reordered). The echo will later swap in the
        // authoritative payload via appendMessage, but the message is no longer grey.
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === tempId ? { ...m, messageId: realId, pending: false } : m,
          ),
          realIdToTempId: { ...store.realIdToTempId(), [realId]: tempId },
        });
      }
    };

    return {
    async loadMessages(guildId: string | null, channelId: string): Promise<void> {
      patchState(store, { isLoading: true, activeChannelId: channelId, activeGuildId: guildId });
      try {
        const response = await service.getMessages(guildId, channelId);
        const messages = [...response.messages].reverse();
        patchState(store, {
          messages,
          hasMore: response.messages.length === 50,
          degraded: response.degraded,
          isLoading: false,
          realIdToTempId: {},
          mentionHighlights: {}, // new channel view → clear any prior highlights
        });
      } catch {
        patchState(store, { isLoading: false });
      }
    },

    async loadOlder(): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId(); // null for a DM
      if (!channelId || store.isLoading() || !store.hasMore()) return;

      // Find oldest real (non-optimistic) message
      const oldest = store.messages().find((m) => !m.tempId);
      if (!oldest) return;

      patchState(store, { isLoading: true });
      try {
        const response = await service.getMessages(guildId, channelId, { before: oldest.messageId });
        const older = [...response.messages].reverse();
        patchState(store, {
          messages: [...older, ...store.messages()],
          hasMore: response.messages.length === 50,
          degraded: response.degraded,
          isLoading: false,
        });
      } catch {
        patchState(store, { isLoading: false });
      }
    },

    async sendMessage(
      content: string,
      attachmentIds: string[] = [],
      replyToId: string | null = null,
    ): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId(); // null for a DM
      const user = auth.currentUser();
      if (!channelId || !user) return;

      const tempId = nextTempId();
      const optimistic: MessageResponse = {
        messageId: String(tempId), // e.g. "-1" — replaced when server confirms
        tempId,
        channelId,
        guildId,
        userId: user.id,
        username: user.username,
        avatarKey: user.avatarKey ?? null,
        content,
        sentAt: Date.now(),
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        messageType: 'Default',
        attachmentIds,
        mentionIds: [],
        replyToId,
        pending: true,
      };

      patchState(store, { messages: [...store.messages(), optimistic] });

      try {
        const response = await service.sendMessage(guildId, channelId, content, {
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
          replyToId: replyToId ?? undefined,
        });
        confirmSent(tempId, response.messageId);
      } catch {
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
          ),
        });
      }
    },

    appendMessage(msg: MessageResponse): void {
      const realIdToTempId = store.realIdToTempId();
      const tempId = realIdToTempId[msg.messageId];

      if (tempId !== undefined) {
        const updated = { ...store.realIdToTempId() };
        delete updated[msg.messageId];
        patchState(store, {
          messages: store.messages().map((m) =>
            m.messageId === msg.messageId ? { ...msg } : m,
          ),
          realIdToTempId: updated,
        });
      } else {
        const exists = store.messages().some((m) => m.messageId === msg.messageId);
        if (!exists) {
          const myId = auth.currentUser()?.id;
          // A live message that mentions me lights up until I leave/rejoin the channel.
          const highlight = myId && msg.mentionIds.includes(myId);
          patchState(store, {
            messages: [...store.messages(), msg],
            ...(highlight
              ? { mentionHighlights: { ...store.mentionHighlights(), [msg.messageId]: true as const } }
              : {}),
          });
        }
      }
    },

    handleFailed(payload: MessageFailedPayload): void {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === payload.messageId ? { ...m, pending: false, failed: true } : m,
        ),
      });
    },

    async retryMessage(tempId: number): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId(); // null for a DM
      const msg = store.messages().find((m) => m.tempId === tempId && m.failed);
      if (!msg || !channelId) return;

      const newTempId = nextTempId();
      patchState(store, {
        messages: store.messages().map((m) =>
          m.tempId === tempId
            ? { ...m, tempId: newTempId, messageId: String(newTempId), failed: false, pending: true }
            : m,
        ),
      });

      try {
        const response = await service.sendMessage(guildId, channelId, msg.content, {
          attachmentIds: msg.attachmentIds.length ? msg.attachmentIds : undefined,
          replyToId: msg.replyToId ?? undefined,
        });
        confirmSent(newTempId, response.messageId);
      } catch {
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === newTempId ? { ...m, pending: false, failed: true } : m,
          ),
        });
      }
    },

    editMessage(messageId: string, content: string, editedAt: number): void {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === messageId ? { ...m, content, isEdited: true, editedAt } : m,
        ),
      });
    },

    deleteMessage(messageId: string): void {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === messageId ? { ...m, isDeleted: true, content: '' } : m,
        ),
      });
    },

    clearMessages(): void {
      patchState(store, {
        messages: [],
        hasMore: true,
        degraded: false,
        activeChannelId: null,
        activeGuildId: null,
        unreadOnOpen: 0,
        realIdToTempId: {},
        mentionHighlights: {},
        replyTarget: null,
        jumpRequest: null,
      });
    },

    /**
     * Requests a scroll-to + highlight of a message (from the pins panel Jump). The nonce bump
     * makes the message-list effect fire even for repeated jumps to the same message.
     */
    requestJump(messageId: string): void {
      patchState(store, { jumpRequest: { messageId, nonce: ++_jumpNonce } });
    },

    /** Sets the message the composer is replying to (banner + replyToId on next send). */
    setReplyTarget(target: ReplyTarget): void {
      patchState(store, { replyTarget: target });
    },

    /** Clears the active reply target (✕ on the banner, after send, or on channel change). */
    clearReplyTarget(): void {
      patchState(store, { replyTarget: null });
    },

    /** Records how many messages were unread when the channel opened (for the jump banner). */
    setUnreadOnOpen(count: number): void {
      patchState(store, { unreadOnOpen: count });
    },

    /**
     * Trims the loaded window to the most recent MESSAGE_WINDOW_CAP messages. Only safe to call
     * while the view is pinned to the bottom (the message list gates it on that) — dropping the
     * oldest, off-screen messages then shifts nothing visible. Marks hasMore so the trimmed
     * history can be re-fetched on scroll-up. No-op under the cap.
     */
    trimToWindow(): void {
      const msgs = store.messages();
      if (msgs.length <= MESSAGE_WINDOW_CAP) return;
      patchState(store, {
        messages: msgs.slice(msgs.length - MESSAGE_WINDOW_CAP),
        hasMore: true,
      });
    },

    /**
     * Seeds the unseen-mention highlights from the unread block — the last `unreadOnOpen`
     * loaded messages that mention me. Call right after a channel's messages load.
     */
    seedMentionHighlights(): void {
      const myId = auth.currentUser()?.id;
      const unread = store.unreadOnOpen();
      if (!myId || unread <= 0) return;
      const msgs = store.messages();
      const boundary = Math.max(0, msgs.length - unread);
      const highlights: Record<string, true> = {};
      for (let i = boundary; i < msgs.length; i++) {
        if (msgs[i].mentionIds.includes(myId)) highlights[msgs[i].messageId] = true;
      }
      patchState(store, { mentionHighlights: highlights });
    },

    /** Whether a message should render as an unseen mention of the current user. */
    isMentionHighlight(messageId: string): boolean {
      return store.mentionHighlights()[messageId] === true;
    },

    /** Dismisses the "X new messages" jump banner. */
    dismissUnreadBanner(): void {
      patchState(store, { unreadOnOpen: 0 });
    },
    };
  }),
);
