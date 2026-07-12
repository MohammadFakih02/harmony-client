import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { Channel, ChannelCapabilities, ChannelCategory, SidebarEntry } from '../models/channel.models';
import { GatewayEvents } from '../hub/gateway-events';
import { ChannelService } from '../services/channel.service';
import { GuildStore } from './guild.store';

interface ChannelState {
  channelsByGuild: Record<string, Channel[]>;
  selectedChannelId: string | null;
  collapsedCategories: Record<string, boolean>;
  lastChannelByGuild: Record<string, string>;
  // The caller's capabilities in the currently-open channel (null while unknown/loading).
  currentCapabilities: ChannelCapabilities | null;
  loading: boolean;
}

const isTextChannel = (c: Channel) => c.type === 'text' || c.type === 'announcement';

// Channel lists are kept position-sorted on write, so the sidebar computeds (which
// re-evaluate on every state change) only filter — filtering preserves order.
const sortChannels = (channels: Channel[]): Channel[] =>
  [...channels].sort((a, b) => a.position - b.position);

/** A category channel + its member channels (in position order) as one render block. */
const toCategory = (
  cat: Channel,
  all: Channel[],
  collapsed: Record<string, boolean>,
): ChannelCategory => ({
  id: cat.id,
  name: cat.name.toUpperCase(),
  channels: all.filter((c) => c.type !== 'category' && c.categoryId === cat.id),
  collapsed: collapsed[cat.id] ?? false,
});

export const ChannelStore = signalStore(
  { providedIn: 'root' },
  withState<ChannelState>({
    channelsByGuild: {},
    selectedChannelId: null,
    collapsedCategories: {},
    lastChannelByGuild: {},
    currentCapabilities: null,
    loading: false,
  }),
  withComputed((store, guildStore = inject(GuildStore)) => ({
    /** Every category (by `type === 'category'` — empty ones included, so a fresh category is
     *  visible, droppable, and offered in the Move-to-Category menu). Position order. */
    currentCategories: computed<ChannelCategory[]>(() => {
      const guildId = guildStore.selectedGuildId();
      if (!guildId) return [];

      const all = store.channelsByGuild()[guildId] ?? [];
      const collapsed = store.collapsedCategories();
      return all.filter((c) => c.type === 'category').map((cat) => toCategory(cat, all, collapsed));
    }),

    /**
     * The sidebar's top-level sequence: category blocks and bare (uncategorized) channels
     * interleaved in global position order. A channel whose categoryId points at a deleted
     * category degrades to top-level rather than vanishing.
     */
    sidebarEntries: computed<SidebarEntry[]>(() => {
      const guildId = guildStore.selectedGuildId();
      if (!guildId) return [];

      const all = store.channelsByGuild()[guildId] ?? [];
      const collapsed = store.collapsedCategories();
      const categoryIds = new Set(all.filter((c) => c.type === 'category').map((c) => c.id));

      const entries: SidebarEntry[] = [];
      for (const c of all) {
        if (c.type === 'category') {
          entries.push({ kind: 'category', category: toCategory(c, all, collapsed) });
        } else if (c.categoryId === null || !categoryIds.has(c.categoryId)) {
          entries.push({ kind: 'channel', channel: c });
        }
      }
      return entries;
    }),

    selectedChannel: computed<Channel | null>(() => {
      const channelId = store.selectedChannelId();
      const guildId = guildStore.selectedGuildId();
      if (!channelId || !guildId) return null;
      return (store.channelsByGuild()[guildId] ?? []).find((c) => c.id === channelId) ?? null;
    }),
  })),
  withMethods((store, service = inject(ChannelService)) => {
    // Dedupe concurrent loads for the same guild (non-reactive — purely a stampede guard).
    // loadChannels is a deliberate refresh (no cache-skip), but simultaneous identical calls
    // (guild activate + forward-modal) share one request instead of racing.
    const inFlight = new Map<string, Promise<void>>();

    // Last-known capabilities per channel: applied instantly on re-open (no null flash while
    // the fetch runs, so the composer doesn't flicker disabled). The fetch stays authoritative.
    const capsCache = new Map<string, ChannelCapabilities>();

    return {
    async loadChannels(guildId: string): Promise<void> {
      const existing = inFlight.get(guildId);
      if (existing) return existing;
      const promise = (async () => {
        patchState(store, { loading: true });
        try {
          const channels = await service.getGuildChannels(guildId);
          patchState(store, {
            channelsByGuild: { ...store.channelsByGuild(), [guildId]: sortChannels(channels) },
            loading: false,
          });
        } catch {
          patchState(store, { loading: false });
        }
      })().finally(() => inFlight.delete(guildId));
      inFlight.set(guildId, promise);
      return promise;
    },

    selectChannel(id: string): void {
      patchState(store, { selectedChannelId: id });
    },

    /** Fetch the caller's capabilities for a channel (drives input-disable + edit/delete UI). */
    async loadCapabilities(guildId: string, channelId: string): Promise<void> {
      patchState(store, { currentCapabilities: capsCache.get(channelId) ?? null });
      try {
        const caps = await service.getCapabilities(guildId, channelId);
        capsCache.set(channelId, caps);
        // Ignore a stale response if the user already switched channels.
        if (store.selectedChannelId() === channelId) {
          patchState(store, { currentCapabilities: caps });
        }
      } catch {
        // Leave the cached/null value → the input stays optimistically enabled; the server
        // still enforces.
      }
    },

    /** Record the channel a user was last on in a guild, so re-entering the guild returns there. */
    rememberChannel(guildId: string, channelId: string): void {
      patchState(store, {
        lastChannelByGuild: { ...store.lastChannelByGuild(), [guildId]: channelId },
      });
    },

    /** Resolve which channel to open when entering a guild: last-visited if still valid, else first text channel. */
    resolveDefaultChannel(guildId: string): string | null {
      const channels = store.channelsByGuild()[guildId] ?? [];
      const last = store.lastChannelByGuild()[guildId];
      if (last && channels.some((c) => c.id === last && isTextChannel(c))) return last;
      // The list is position-sorted on write, so the first text channel is the lowest position.
      return channels.find(isTextChannel)?.id ?? null;
    },

    toggleCategory(categoryId: string): void {
      const current = store.collapsedCategories();
      patchState(store, {
        collapsedCategories: { ...current, [categoryId]: !current[categoryId] },
      });
    },

    addChannel(channel: Channel): void {
      const gid = channel.guildId;
      const existing = store.channelsByGuild()[gid] ?? [];
      // Idempotent: the creator both adds optimistically (createChannel) and receives the
      // ChannelCreated broadcast — without this dedup the channel would appear twice.
      if (existing.some((c) => c.id === channel.id)) return;
      patchState(store, {
        channelsByGuild: { ...store.channelsByGuild(), [gid]: sortChannels([...existing, channel]) },
      });
    },

    updateChannel(channel: Channel): void {
      const gid = channel.guildId;
      const existing = store.channelsByGuild()[gid] ?? [];
      patchState(store, {
        channelsByGuild: {
          ...store.channelsByGuild(),
          // Re-sort: an update can carry a position change (reorder broadcast).
          [gid]: sortChannels(existing.map((c) => (c.id === channel.id ? channel : c))),
        },
      });
    },

    removeChannel(channelId: string): void {
      const updated: Record<string, Channel[]> = {};
      for (const [gid, channels] of Object.entries(store.channelsByGuild())) {
        updated[gid] = channels.filter((c) => c.id !== channelId);
      }
      patchState(store, { channelsByGuild: updated });
    },

    /**
     * Drag-reorder channels within one rendered category group: the group's channels take
     * positions 0..n (within-group order is all the grouping reads — channels in other groups
     * never compete). Optimistic + persisted; reverts on failure.
     */
    async reorderChannels(guildId: string, orderedIds: string[]): Promise<void> {
      const previous = store.channelsByGuild()[guildId] ?? [];
      const posById = new Map(orderedIds.map((id, i) => [id, i]));
      const next = sortChannels(
        previous.map((c) => (posById.has(c.id) ? { ...c, position: posById.get(c.id)! } : c)),
      );
      patchState(store, { channelsByGuild: { ...store.channelsByGuild(), [guildId]: next } });
      try {
        await service.reorder(
          guildId,
          orderedIds.map((channelId, i) => ({ channelId, position: i })),
        );
      } catch {
        patchState(store, {
          channelsByGuild: { ...store.channelsByGuild(), [guildId]: previous },
        });
      }
    },

    async createChannel(
      guildId: string,
      name: string,
      type: 'text' | 'voice' | 'category',
    ): Promise<Channel> {
      const channel = await service.createChannel(guildId, name, type);
      const existing = store.channelsByGuild()[guildId] ?? [];
      patchState(store, {
        channelsByGuild: {
          ...store.channelsByGuild(),
          [guildId]: sortChannels([...existing, channel]),
        },
      });
      return channel;
    },

    /** Moves a channel into a category (or out to top-level when categoryId is null).
     *  Optimistic; reverts on failure. Used by both the right-click submenu and cross-category drag. */
    async moveToCategory(
      guildId: string,
      channelId: string,
      categoryId: string | null,
    ): Promise<void> {
      const previous = store.channelsByGuild()[guildId] ?? [];
      const optimistic = previous.map((c) => (c.id === channelId ? { ...c, categoryId } : c));
      patchState(store, { channelsByGuild: { ...store.channelsByGuild(), [guildId]: optimistic } });
      try {
        const updated = await service.moveToCategory(guildId, channelId, categoryId);
        const list = store.channelsByGuild()[guildId] ?? [];
        patchState(store, {
          channelsByGuild: {
            ...store.channelsByGuild(),
            [guildId]: sortChannels(list.map((c) => (c.id === channelId ? updated : c))),
          },
        });
      } catch (err) {
        patchState(store, {
          channelsByGuild: { ...store.channelsByGuild(), [guildId]: previous },
        });
        throw err;
      }
    },

    /** Saves channel settings (name/topic/NSFW/slowmode + voice bitrate/userLimit). The
     *  ChannelUpdated broadcast also arrives for other clients; applying the response here
     *  updates the editor immediately. */
    async saveChannel(
      guildId: string,
      channelId: string,
      patch: {
        name?: string;
        topic?: string | null;
        isNsfw?: boolean;
        slowmodeSeconds?: number;
        bitrate?: number;
        userLimit?: number;
      },
    ): Promise<Channel> {
      const updated = await service.update(guildId, channelId, patch);
      const list = store.channelsByGuild()[guildId] ?? [];
      patchState(store, {
        channelsByGuild: {
          ...store.channelsByGuild(),
          [guildId]: sortChannels(list.map((c) => (c.id === channelId ? updated : c))),
        },
      });
      return updated;
    },

    /** Deletes a channel (ManageChannels). Optimistically removes it; the ChannelDeleted
     *  broadcast reconciles other clients. Reverts the local list if the request fails. */
    async deleteChannel(guildId: string, channelId: string): Promise<void> {
      const previous = store.channelsByGuild()[guildId] ?? [];
      patchState(store, {
        channelsByGuild: {
          ...store.channelsByGuild(),
          [guildId]: previous.filter((c) => c.id !== channelId),
        },
      });
      try {
        await service.delete(guildId, channelId);
      } catch (err) {
        patchState(store, {
          channelsByGuild: { ...store.channelsByGuild(), [guildId]: previous },
        });
        throw err;
      }
    },
    };
  }),
  withHooks({
    // Channel CRUD arrives for every guild we've joined — the add/update/remove methods are
    // keyed by the channel's own guildId, so no cache guard is needed here.
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'ChannelCreated':
            store.addChannel(e.channel);
            break;
          case 'ChannelUpdated':
            store.updateChannel(e.channel);
            break;
          case 'ChannelDeleted':
            store.removeChannel(e.channelId);
            break;
        }
      });
    },
  }),
);
