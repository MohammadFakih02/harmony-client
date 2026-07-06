import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { UnreadCountPayload, UnreadCountResponse } from '../models/message.models';
import { MessageService } from '../services/message.service';

interface UnreadState {
  counts: Record<string, number>; // channelId (string) → unread count
  channelGuild: Record<string, string>; // channelId → guildId, for per-guild rollup
  loading: boolean;
}

export const UnreadStore = signalStore(
  { providedIn: 'root' },
  withState<UnreadState>({ counts: {}, channelGuild: {}, loading: false }),
  withMethods((store, service = inject(MessageService)) => ({
    /** Distributes a full unread snapshot (bootstrap payload or the /me/unread refresh). */
    applyAll(responses: UnreadCountResponse[]): void {
      const counts: Record<string, number> = {};
      const channelGuild: Record<string, string> = {};
      for (const r of responses) {
        if (r.guildId != null) channelGuild[r.channelId] = r.guildId;
        if (r.unreadCount > 0) counts[r.channelId] = r.unreadCount;
      }
      patchState(store, { counts, channelGuild, loading: false });
    },

    async loadAll(): Promise<void> {
      patchState(store, { loading: true });
      try {
        this.applyAll(await service.getUnreadCounts());
      } catch {
        patchState(store, { loading: false });
      }
    },

    setCount(payload: UnreadCountPayload): void {
      patchState(store, {
        counts: { ...store.counts(), [payload.channelId]: payload.unreadCount },
        // Only guild channels roll up to a guild badge; a DM (guildId null) doesn't.
        ...(payload.guildId != null
          ? { channelGuild: { ...store.channelGuild(), [payload.channelId]: payload.guildId } }
          : {}),
      });
    },

    /** Sum of unread across all known channels in a guild — drives the guild-icon badge. */
    guildUnreadCount(guildId: string): number {
      const counts = store.counts();
      const channelGuild = store.channelGuild();
      let total = 0;
      for (const channelId of Object.keys(counts)) {
        if (channelGuild[channelId] === guildId) total += counts[channelId];
      }
      return total;
    },

    async markRead(
      guildId: string | null,
      channelId: string,
      lastReadMessageId: string,
    ): Promise<void> {
      patchState(store, {
        counts: { ...store.counts(), [channelId]: 0 },
        ...(guildId != null
          ? { channelGuild: { ...store.channelGuild(), [channelId]: guildId } }
          : {}),
      });
      try {
        await service.markRead(guildId, channelId, lastReadMessageId);
      } catch {
        // Fail open — truth is in ScyllaDB read_states
      }
    },
  })),
);
