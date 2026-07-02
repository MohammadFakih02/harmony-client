import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { Channel, ChannelCapabilities, ChannelCategory } from '../models/channel.models';
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
    currentCategories: computed<ChannelCategory[]>(() => {
      const guildId = guildStore.selectedGuildId();
      if (!guildId) return [];

      const all = store.channelsByGuild()[guildId] ?? [];
      const collapsed = store.collapsedCategories();

      const categoryIds = new Set(
        all.filter((c) => c.categoryId !== null).map((c) => c.categoryId!),
      );
      const categoryChannels = all
        .filter((c) => categoryIds.has(c.id))
        .sort((a, b) => a.position - b.position);
      const leafChannels = all.filter(
        (c) => !categoryIds.has(c.id) && c.type !== 'category',
      );

      const categories: ChannelCategory[] = categoryChannels.map((cat) => ({
        id: cat.id,
        name: cat.name.toUpperCase(),
        channels: leafChannels
          .filter((c) => c.categoryId === cat.id)
          .sort((a, b) => a.position - b.position),
        collapsed: collapsed[cat.id] ?? false,
      }));

      const uncategorized = leafChannels.filter((c) => c.categoryId === null);
      if (uncategorized.length > 0) {
        categories.unshift({
          id: null,
          name: '',
          channels: uncategorized.sort((a, b) => a.position - b.position),
          collapsed: false,
        });
      }

      return categories;
    }),

    selectedChannel: computed<Channel | null>(() => {
      const channelId = store.selectedChannelId();
      const guildId = guildStore.selectedGuildId();
      if (!channelId || !guildId) return null;
      return (store.channelsByGuild()[guildId] ?? []).find((c) => c.id === channelId) ?? null;
    }),
  })),
  withMethods((store, service = inject(ChannelService)) => ({
    async loadChannels(guildId: string): Promise<void> {
      patchState(store, { loading: true });
      try {
        const channels = await service.getGuildChannels(guildId);
        patchState(store, {
          channelsByGuild: { ...store.channelsByGuild(), [guildId]: channels },
          loading: false,
        });
      } catch {
        patchState(store, { loading: false });
      }
    },

    selectChannel(id: string): void {
      patchState(store, { selectedChannelId: id });
    },

    /** Fetch the caller's capabilities for a channel (drives input-disable + edit/delete UI). */
    async loadCapabilities(guildId: string, channelId: string): Promise<void> {
      patchState(store, { currentCapabilities: null });
      try {
        const caps = await service.getCapabilities(guildId, channelId);
        // Ignore a stale response if the user already switched channels.
        if (store.selectedChannelId() === channelId) {
          patchState(store, { currentCapabilities: caps });
        }
      } catch {
        // Leave null → the input stays optimistically enabled; the server still enforces.
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
      const firstText = [...channels].filter(isTextChannel).sort((a, b) => a.position - b.position)[0];
      return firstText?.id ?? null;
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
        channelsByGuild: { ...store.channelsByGuild(), [gid]: [...existing, channel] },
      });
    },

    updateChannel(channel: Channel): void {
      const gid = channel.guildId;
      const existing = store.channelsByGuild()[gid] ?? [];
      patchState(store, {
        channelsByGuild: {
          ...store.channelsByGuild(),
          [gid]: existing.map((c) => (c.id === channel.id ? channel : c)),
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

    async createChannel(guildId: string, name: string, type: 'text' | 'voice'): Promise<Channel> {
      const channel = await service.createChannel(guildId, name, type);
      const existing = store.channelsByGuild()[guildId] ?? [];
      patchState(store, {
        channelsByGuild: { ...store.channelsByGuild(), [guildId]: [...existing, channel] },
      });
      return channel;
    },
  })),
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
