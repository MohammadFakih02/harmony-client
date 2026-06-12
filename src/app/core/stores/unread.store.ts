import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { UnreadCountPayload } from '../models/message.models';
import { MessageService } from '../services/message.service';

interface UnreadState {
  counts: Record<number, number>; // channelId → unread count
  loading: boolean;
}

export const UnreadStore = signalStore(
  { providedIn: 'root' },
  withState<UnreadState>({ counts: {}, loading: false }),
  withMethods((store, service = inject(MessageService)) => ({
    async loadAll(): Promise<void> {
      patchState(store, { loading: true });
      try {
        const responses = await service.getUnreadCounts();
        const counts: Record<number, number> = {};
        for (const r of responses) {
          if (r.unreadCount > 0) counts[r.channelId] = r.unreadCount;
        }
        patchState(store, { counts, loading: false });
      } catch {
        patchState(store, { loading: false });
      }
    },

    // Called when SignalR fires UnreadCountUpdated
    setCount(payload: UnreadCountPayload): void {
      patchState(store, {
        counts: { ...store.counts(), [payload.channelId]: payload.unreadCount },
      });
    },

    // Mark a channel as read; zeroes the local count and POSTs to the backend
    async markRead(guildId: number, channelId: number, lastReadMessageId: number): Promise<void> {
      patchState(store, { counts: { ...store.counts(), [channelId]: 0 } });
      try {
        await service.markRead(guildId, channelId, lastReadMessageId);
      } catch {
        // Fail open — the local count is already cleared; truth is in ScyllaDB
      }
    },
  })),
);
