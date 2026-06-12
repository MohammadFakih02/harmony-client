import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { MessageFailedPayload, MessageResponse } from '../models/message.models';
import { AuthService } from '../services/auth.service';
import { MessageService } from '../services/message.service';

// Module-level counter — avoids tempId collisions when multiple messages are sent
// in the same millisecond (which -(Date.now()) would not protect against).
let _tempIdCounter = -1;
const nextTempId = (): number => _tempIdCounter--;

interface MessageState {
  messages: MessageResponse[];
  isLoading: boolean;
  hasMore: boolean;
  degraded: boolean;
  activeChannelId: number | null;
  activeGuildId: number | null;
  // Maps realId → tempId for reconciling optimistic entries when SignalR fires
  realIdToTempId: Record<number, number>;
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
  withMethods((store, service = inject(MessageService), auth = inject(AuthService)) => ({
    async loadMessages(guildId: number, channelId: number): Promise<void> {
      patchState(store, { isLoading: true, activeChannelId: channelId, activeGuildId: guildId });
      try {
        const response = await service.getMessages(channelId);
        // Backend returns newest-first; reverse for oldest-at-top display
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

      // Oldest message is first in the array (after the reverse in loadMessages)
      const oldest = store.messages().find((m) => (m.messageId ?? 0) > 0);
      if (!oldest) return;

      patchState(store, { isLoading: true });
      try {
        const response = await service.getMessages(channelId, { before: oldest.messageId });
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

    async sendMessage(content: string): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      const user = auth.currentUser();
      if (!channelId || !guildId || !user) return;

      const tempId = nextTempId();
      const optimistic: MessageResponse = {
        messageId: tempId,
        tempId,
        channelId,
        guildId,
        userId: Number(user.id),
        username: user.username,
        avatarKey: user.avatarKey ?? null,
        content,
        createdAt: new Date().toISOString(),
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        messageType: 'Default',
        attachmentIds: [],
        mentionIds: [],
        replyToId: null,
        pending: true,
      };

      patchState(store, { messages: [...store.messages(), optimistic] });

      try {
        const response = await service.sendMessage(guildId, channelId, content);
        // Replace the tempId entry with the real ID so reconcileOptimistic can match it
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === tempId ? { ...m, messageId: response.messageId } : m,
          ),
          realIdToTempId: { ...store.realIdToTempId(), [response.messageId]: tempId },
        });
      } catch {
        // Mark the optimistic entry as failed
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
          ),
        });
      }
    },

    // Called when SignalR fires MessageReceived.
    // If the message ID is in realIdToTempId, it's our own optimistic message → replace with
    // authoritative server data. Otherwise it's from another user → append.
    appendMessage(msg: MessageResponse): void {
      const realIdToTempId = store.realIdToTempId();
      const tempId = realIdToTempId[msg.messageId];

      if (tempId !== undefined) {
        // Reconcile: swap the pending entry with the full server message
        const updated = { ...store.realIdToTempId() };
        delete updated[msg.messageId];
        patchState(store, {
          messages: store.messages().map((m) =>
            m.messageId === msg.messageId ? { ...msg } : m,
          ),
          realIdToTempId: updated,
        });
      } else {
        // Message from someone else — guard against duplicates (shouldn't happen but be safe)
        const exists = store.messages().some((m) => m.messageId === msg.messageId);
        if (!exists) {
          patchState(store, { messages: [...store.messages(), msg] });
        }
      }
    },

    // Called when SignalR fires MessageFailed (terminal write failure after retries)
    handleFailed(payload: MessageFailedPayload): void {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === payload.messageId ? { ...m, pending: false, failed: true } : m,
        ),
      });
    },

    // Re-sends a failed optimistic message identified by its tempId.
    async retryMessage(tempId: number): Promise<void> {
      const channelId = store.activeChannelId();
      const guildId = store.activeGuildId();
      const msg = store.messages().find((m) => m.tempId === tempId && m.failed);
      if (!msg || !channelId || !guildId) return;

      const newTempId = nextTempId();
      // Replace the failed entry with a fresh pending one (new tempId so the old failure is gone)
      patchState(store, {
        messages: store.messages().map((m) =>
          m.tempId === tempId
            ? { ...m, tempId: newTempId, messageId: newTempId, failed: false, pending: true }
            : m,
        ),
      });

      try {
        const response = await service.sendMessage(guildId, channelId, msg.content);
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === newTempId ? { ...m, messageId: response.messageId } : m,
          ),
          realIdToTempId: { ...store.realIdToTempId(), [response.messageId]: newTempId },
        });
      } catch {
        patchState(store, {
          messages: store.messages().map((m) =>
            m.tempId === newTempId ? { ...m, pending: false, failed: true } : m,
          ),
        });
      }
    },

    editMessage(messageId: number, content: string, editedAt: string): void {
      patchState(store, {
        messages: store.messages().map((m) =>
          m.messageId === messageId ? { ...m, content, isEdited: true, editedAt } : m,
        ),
      });
    },

    deleteMessage(messageId: number): void {
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
  })),
);
