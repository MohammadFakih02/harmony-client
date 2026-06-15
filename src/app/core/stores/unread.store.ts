import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { UnreadCountPayload } from '../models/message.models';
import { MessageService } from '../services/message.service';

interface UnreadState {
  counts: Record<string, number>; // channelId (string) → unread count
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
        const counts: Record<string, number> = {};
        for (const r of responses) {
          if (r.unreadCount > 0) counts[r.channelId] = r.unreadCount;
        }
        patchState(store, { counts, loading: false });
      } catch {
        patchState(store, { loading: false });
      }
    },

    setCount(payload: UnreadCountPayload): void {
      patchState(store, {
        counts: { ...store.counts(), [payload.channelId]: payload.unreadCount },
      });
    },

    async markRead(guildId: string, channelId: string, lastReadMessageId: string): Promise<void> {
      patchState(store, { counts: { ...store.counts(), [channelId]: 0 } });
      try {
        await service.markRead(guildId, channelId, lastReadMessageId);
      } catch {
        // Fail open — truth is in ScyllaDB read_states
      }
    },
  })),
);
