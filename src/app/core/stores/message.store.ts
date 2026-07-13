import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import {
  MessageFailedPayload,
  MessageResponse,
  ReactionPayload,
  ReactionSummary,
  ReplyTarget,
} from '../models/message.models';
import { GatewayEvents } from '../hub/gateway-events';
import { AuthService } from '../services/auth.service';
import { MessageService } from '../services/message.service';
import { SignalRService } from '../services/signalr.service';
import { ReactionService } from '../services/reaction.service';
import { ToastService } from '../services/toast.service';
import { extractApiError } from '../../shared/util/api-error';

let _tempIdCounter = -1;
const nextTempId = (): number => _tempIdCounter--;

// Opaque per-send idempotency token, echoed back on the live MessageReceived broadcast so the
// sender reconciles its optimistic bubble in place regardless of echo/POST ordering.
const newNonce = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Applies one reaction delta to a message's pill list, immutably. `delta` is +1 (add) or -1
 * (remove); `isMe` flips the pill's meReacted flag (a foreign reaction only moves the count). A pill
 * appears when its first reactor arrives and disappears when its last one leaves. Pure so both the
 * optimistic toggle and the gateway reconcile share one source of truth.
 */
function applyReactionDelta(
  pills: readonly ReactionSummary[],
  emoji: string,
  delta: 1 | -1,
  isMe: boolean,
): ReactionSummary[] {
  const idx = pills.findIndex((p) => p.emoji === emoji);
  if (delta > 0) {
    if (idx === -1) return [...pills, { emoji, count: 1, meReacted: isMe }];
    const next = [...pills];
    next[idx] = {
      ...next[idx],
      count: next[idx].count + 1,
      meReacted: next[idx].meReacted || isMe,
    };
    return next;
  }
  if (idx === -1) return [...pills];
  const cur = pills[idx];
  const count = cur.count - 1;
  if (count <= 0) return pills.filter((_, i) => i !== idx);
  const next = [...pills];
  next[idx] = { ...cur, count, meReacted: isMe ? false : cur.meReacted };
  return next;
}

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
  // True while viewing a historical window (jumped to an old message via search/reply) rather than
  // the live tail. While anchored: live SignalR appends are suppressed (no viewport yank), a
  // "Jump to Present" pill shows, and scrolling to the bottom loads newer messages until the true
  // tail is reached — which clears this back to normal live behaviour.
  anchored: boolean;
  // A cross-channel jump target parked while the router navigates to another channel; the channel
  // component consumes it after the route settles and loads the around-window instead of the latest.
  pendingJump: { guildId: string | null; channelId: string; messageId: string } | null;
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
    anchored: false,
    pendingJump: null,
  }),
  withMethods((
    store,
    service = inject(MessageService),
    signalr = inject(SignalRService),
    auth = inject(AuthService),
    reactions = inject(ReactionService),
    toast = inject(ToastService),
  ) => {
    /**
     * Sends via the hub when the socket is live (primary path — one round-trip returns the persisted
     * id, and the full message arrives on the MessageReceived broadcast, reconciled by nonce), and
     * falls back to REST while the socket is down. Returns the authoritative message id either way.
     */
    const dispatchSend = async (
      guildId: string | null,
      channelId: string,
      content: string,
      opts: { attachmentIds?: string[]; replyToId?: string; nonce?: string },
    ): Promise<string> => {
      if (signalr.isConnected) {
        return signalr.sendMessage(guildId, channelId, content, opts);
      }
      const response = await service.sendMessage(guildId, channelId, content, opts);
      return response.messageId;
    };
    /** Rewrites one loaded message's pill list via `applyReactionDelta`; no-op if not loaded. */
    const mutateReactions = (
      messageId: string,
      emoji: string,
      delta: 1 | -1,
      isMe: boolean,
    ): void => {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === messageId
            ? { ...m, reactions: applyReactionDelta(m.reactions ?? [], emoji, delta, isMe) }
            : m,
        ),
      });
    };
    // Instant re-open: settled messages stashed per channel when the view switches away, painted
    // synchronously on return while the fresh fetch (still authoritative) is in flight.
    // Non-reactive — only read inside load calls. LRU-capped so a long session stays bounded.
    const MESSAGE_CACHE_MAX_CHANNELS = 20;
    const cacheByChannel = new Map<string, MessageResponse[]>();

    /** Stashes the active channel's settled messages (never pending/failed optimistics). */
    const stashActive = (): void => {
      const channelId = store.activeChannelId();
      if (!channelId) return;
      const settled = store.messages().filter((m) => !m.pending && !m.failed);
      if (!settled.length) return;
      cacheByChannel.delete(channelId); // re-insert → most-recently-used
      cacheByChannel.set(channelId, settled);
      if (cacheByChannel.size > MESSAGE_CACHE_MAX_CHANNELS) {
        const oldest = cacheByChannel.keys().next().value;
        if (oldest !== undefined) cacheByChannel.delete(oldest);
      }
    };

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

    /**
     * True while `channelId` is still the active channel. Every history fetch checks this after
     * its await so a slow response for a channel the user already left is discarded instead of
     * clobbering the new channel's list (the promise-based equivalent of a switchMap cancel).
     */
    const isCurrent = (channelId: string): boolean => store.activeChannelId() === channelId;

    /**
     * Loads the latest page into the active channel and drops any anchored (history) state — the
     * shared core of a fresh channel open and "Jump to Present". Assumes activeChannel/Guild are set.
     */
    const fetchLatestInto = async (guildId: string | null, channelId: string): Promise<void> => {
      const response = await service.getMessages(guildId, channelId);
      if (!isCurrent(channelId)) return; // stale — the user switched channels mid-flight
      patchState(store, {
        messages: [...response.messages].reverse(),
        hasMore: response.messages.length === 50,
        degraded: response.degraded,
        anchored: false,
        realIdToTempId: {},
      });
    };

    return {
    async loadMessages(guildId: string | null, channelId: string): Promise<void> {
      if (store.activeChannelId() !== channelId) stashActive();
      // Paint the cached list instantly (or clear, so the previous channel's content never
      // bleeds into the new view); the fetch below replaces it wholesale.
      const cached = cacheByChannel.get(channelId) ?? [];
      patchState(store, {
        isLoading: true,
        activeChannelId: channelId,
        activeGuildId: guildId,
        messages: cached,
        hasMore: true,
        anchored: false,
        realIdToTempId: {},
      });
      try {
        await fetchLatestInto(guildId, channelId);
        if (!isCurrent(channelId)) return; // stale — a newer load owns the state now
        patchState(store, {
          isLoading: false,
          mentionHighlights: {}, // new channel view → clear any prior highlights
        });
      } catch {
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
      }
    },

    /**
     * Loads a window centred on `messageId` (a search result / reply reference) and enters anchored
     * mode: the target is scrolled to + flashed, live appends pause, and a "Jump to Present" pill
     * shows until the user scrolls back to the live tail. Also sets the active channel, so it works
     * whether jumping within the open channel or after navigating to another.
     */
    async jumpToMessage(guildId: string | null, channelId: string, messageId: string): Promise<void> {
      if (store.activeChannelId() !== channelId) stashActive();
      patchState(store, { isLoading: true, activeChannelId: channelId, activeGuildId: guildId });
      try {
        const response = await service.getMessages(guildId, channelId, { around: messageId });
        if (!isCurrent(channelId)) return; // stale — the user switched channels mid-flight
        patchState(store, {
          messages: [...response.messages].reverse(),
          // We loaded a centred window: older history is (almost always) re-loadable on scroll-up,
          // and there are newer messages we haven't loaded → stay anchored until the tail is reached.
          hasMore: true,
          anchored: true,
          degraded: response.degraded,
          isLoading: false,
          realIdToTempId: {},
          mentionHighlights: {},
          jumpRequest: { messageId, nonce: ++_jumpNonce },
        });
      } catch {
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
      }
    },

    /**
     * Scroll-down "load newer" while anchored: appends the page after the newest loaded message.
     * A short page means we've reached the true tail → leave anchored mode (back to live).
     */
    async loadNewer(): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      if (!channelId || !store.anchored() || store.isLoading()) return;

      const newest = [...store.messages()].reverse().find((m) => !m.tempId);
      if (!newest) return;

      patchState(store, { isLoading: true });
      try {
        const response = await service.getMessages(guildId, channelId, { after: newest.messageId });
        if (!isCurrent(channelId)) return; // stale — the user switched channels mid-flight
        const newer = [...response.messages].reverse();
        const reachedTail = response.messages.length < 50;
        patchState(store, {
          messages: [...store.messages(), ...newer],
          degraded: response.degraded,
          isLoading: false,
          anchored: !reachedTail,
        });
      } catch {
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
      }
    },

    /** Returns to the live tail from anchored history mode (the "Jump to Present" pill). */
    async jumpToPresent(): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      if (!channelId) return;
      patchState(store, { isLoading: true });
      try {
        await fetchLatestInto(guildId, channelId);
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
      } catch {
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
      }
    },

    /** Parks a cross-channel jump target; the channel component consumes it once the route settles. */
    requestChannelJump(guildId: string | null, channelId: string, messageId: string): void {
      patchState(store, { pendingJump: { guildId, channelId, messageId } });
    },

    /** Returns and clears a parked jump if it targets the given channel; else null. */
    consumePendingJump(
      channelId: string,
    ): { guildId: string | null; channelId: string; messageId: string } | null {
      const pending = store.pendingJump();
      if (!pending || pending.channelId !== channelId) return null;
      patchState(store, { pendingJump: null });
      return pending;
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
        if (!isCurrent(channelId)) return; // stale — the user switched channels mid-flight
        const older = [...response.messages].reverse();
        patchState(store, {
          messages: [...older, ...store.messages()],
          hasMore: response.messages.length === 50,
          degraded: response.degraded,
          isLoading: false,
        });
      } catch {
        if (isCurrent(channelId)) patchState(store, { isLoading: false });
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

      // Sending from a historical view snaps back to the live tail first, so the new message lands
      // (and stays visible) at the bottom rather than being appended into an old window.
      if (store.anchored()) {
        await fetchLatestInto(guildId, channelId).catch(() => {});
      }

      const tempId = nextTempId();
      const nonce = newNonce();
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
        nonce,
        pending: true,
      };

      patchState(store, { messages: [...store.messages(), optimistic] });

      try {
        const realId = await dispatchSend(guildId, channelId, content, {
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
          replyToId: replyToId ?? undefined,
          nonce,
        });
        confirmSent(tempId, realId);
      } catch (err) {
        const failedReason = extractApiError(err);
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === tempId ? { ...m, pending: false, failed: true, failedReason } : m,
          ),
        });
      }
    },

    appendMessage(msg: MessageResponse): void {
      // While anchored to a historical window, don't append live messages — that would yank the
      // reader. They surface (with everything else) when they hit "Jump to Present". The unread
      // badge still updates via UnreadStore, and edits/deletes below still apply to loaded messages.
      if (store.anchored()) return;

      // Nonce-first reconcile: the live echo of MY OWN send carries the nonce I stamped on the
      // optimistic bubble. Match on it before the id map so the bubble is replaced in place
      // regardless of whether this echo beats the POST/hub ack — no transient duplicate, no false
      // failure. (The echo is the only broadcast that carries a nonce; historical loads never do.)
      if (msg.nonce) {
        const mine = store.messages().find((m) => m.tempId !== undefined && m.nonce === msg.nonce);
        if (mine) {
          const map = { ...store.realIdToTempId() };
          delete map[msg.messageId];
          patchState(store, {
            messages: store.messages().map((m) => (m.nonce === msg.nonce ? { ...msg } : m)),
            realIdToTempId: map,
          });
          return;
        }
      }

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
      const nonce = newNonce();
      patchState(store, {
        messages: store.messages().map((m) =>
          m.tempId === tempId
            ? {
                ...m,
                tempId: newTempId,
                messageId: String(newTempId),
                nonce,
                failed: false,
                failedReason: undefined,
                pending: true,
              }
            : m,
        ),
      });

      try {
        const realId = await dispatchSend(guildId, channelId, msg.content, {
          attachmentIds: msg.attachmentIds.length ? msg.attachmentIds : undefined,
          replyToId: msg.replyToId ?? undefined,
          nonce,
        });
        confirmSent(newTempId, realId);
      } catch (err) {
        const failedReason = extractApiError(err);
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === newTempId ? { ...m, pending: false, failed: true, failedReason } : m,
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
      stashActive(); // leaving the channel view entirely still feeds the re-open cache
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
        anchored: false,
        pendingJump: null,
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

    /**
     * Toggles the current user's reaction to `emoji` on `msg`: optimistically mutates the pill row
     * (add if not mine, remove if already mine), fires the REST call, and reverts on failure. Skips
     * optimistic messages (no server id yet). The authoritative echo arrives via the gateway and is
     * de-duplicated against this optimistic state (see reactionAdded/reactionRemoved).
     */
    async toggleReaction(msg: MessageResponse, emoji: string): Promise<void> {
      if (msg.pending || msg.failed || msg.tempId !== undefined) return;
      const current = store.messages().find((m) => m.messageId === msg.messageId);
      if (!current) return;
      const mine = current.reactions?.find((r) => r.emoji === emoji)?.meReacted ?? false;
      const delta: 1 | -1 = mine ? -1 : 1;

      mutateReactions(msg.messageId, emoji, delta, true); // optimistic
      try {
        if (mine) await reactions.remove(msg.guildId, msg.channelId, msg.messageId, emoji);
        else await reactions.add(msg.guildId, msg.channelId, msg.messageId, emoji);
      } catch {
        mutateReactions(msg.messageId, emoji, (delta === 1 ? -1 : 1), true); // revert
        toast.info('Could not update reaction', 'fa-triangle-exclamation');
      }
    },

    /**
     * Live ReactionAdded: bumps that emoji's pill on the loaded message. A self-echo (userId == me)
     * that we already applied optimistically is a no-op — guarded on meReacted so the count never
     * double-counts.
     */
    reactionAdded(payload: ReactionPayload): void {
      const isMe = payload.userId === auth.currentUser()?.id;
      if (isMe) {
        const pill = store.messages()
          .find((m) => m.messageId === payload.messageId)
          ?.reactions?.find((r) => r.emoji === payload.emoji);
        if (pill?.meReacted) return; // our own optimistic add already landed
      }
      mutateReactions(payload.messageId, payload.emoji, 1, isMe);
    },

    /** Live ReactionRemoved: decrements the pill; a self-echo already applied optimistically no-ops. */
    reactionRemoved(payload: ReactionPayload): void {
      const isMe = payload.userId === auth.currentUser()?.id;
      if (isMe) {
        const pill = store.messages()
          .find((m) => m.messageId === payload.messageId)
          ?.reactions?.find((r) => r.emoji === payload.emoji);
        if (!pill || !pill.meReacted) return; // our own optimistic remove already landed
      }
      mutateReactions(payload.messageId, payload.emoji, -1, isMe);
    },
    };
  }),
  withHooks({
    // Own the message lifecycle events off the unified gateway stream. Location-aware reactions
    // (mark-read-if-active, DM resurface) stay in the shell — this store only mutates its own list.
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'MessageReceived':
            store.appendMessage(e.message);
            break;
          case 'MessageEdited':
            store.editMessage(e.edit.messageId, e.edit.content, e.edit.editedAt);
            break;
          case 'MessageDeleted':
            store.deleteMessage(e.messageId);
            break;
          case 'MessageFailed':
            store.handleFailed(e.payload);
            break;
          case 'ReactionAdded':
            store.reactionAdded(e.payload);
            break;
          case 'ReactionRemoved':
            store.reactionRemoved(e.payload);
            break;
        }
      });
    },
  }),
);
