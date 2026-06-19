import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { MessageFailedPayload, MessageResponse } from '../models/message.models';
import { AuthService } from '../services/auth.service';
import { MessageService } from '../services/message.service';

let _tempIdCounter = -1;
const nextTempId = (): number => _tempIdCounter--;

interface MessageState {
  messages: MessageResponse[];
  isLoading: boolean;
  hasMore: boolean;
  degraded: boolean;
  activeChannelId: string | null;
  activeGuildId: string | null;
  // Maps server messageId (string) → local tempId (number)
  realIdToTempId: Record<string, number>;
}

export const MessageStore = signalStore(
  { providedIn: 'root' },
  withState<MessageState>({
    messages: [],
    isLoading: false,
    hasMore: true,
    degraded: false,
    activeChannelId: null,
    activeGuildId: null,
    realIdToTempId: {},
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
    async loadMessages(guildId: string, channelId: string): Promise<void> {
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
        });
      } catch {
        patchState(store, { isLoading: false });
      }
    },

    async loadOlder(): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      if (!channelId || !guildId || store.isLoading() || !store.hasMore()) return;

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

    async sendMessage(content: string, attachmentIds: string[] = []): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      const user = auth.currentUser();
      if (!channelId || !guildId || !user) return;

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
        replyToId: null,
        pending: true,
      };

      patchState(store, { messages: [...store.messages(), optimistic] });

      try {
        const response = await service.sendMessage(guildId, channelId, content, {
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
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
          patchState(store, { messages: [...store.messages(), msg] });
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
      const guildId = store.activeGuildId();
      const msg = store.messages().find((m) => m.tempId === tempId && m.failed);
      if (!msg || !channelId || !guildId) return;

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
        realIdToTempId: {},
      });
    },
    };
  }),
);
