import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Channel, ChannelCategory } from '../models/channel.models';
import { ChannelService } from '../services/channel.service';
import { GuildStore } from './guild.store';

interface ChannelState {
  channelsByGuild: Record<number, Channel[]>;
  selectedChannelId: number | null;
  // Tracks which category IDs the user has collapsed; persists across channel navigation
  collapsedCategories: Record<number, boolean>;
  loading: boolean;
}

export const ChannelStore = signalStore(
  { providedIn: 'root' },
  withState<ChannelState>({
    channelsByGuild: {},
    selectedChannelId: null,
    collapsedCategories: {},
    loading: false,
  }),
  withComputed((store, guildStore = inject(GuildStore)) => ({
    currentCategories: computed<ChannelCategory[]>(() => {
      const guildId = guildStore.selectedGuildId();
      if (!guildId) return [];

      const all = store.channelsByGuild()[guildId] ?? [];
      const collapsed = store.collapsedCategories();

      // Identify category containers: channels that other channels point to via categoryId
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

      // Channels with no category go first
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
    async loadChannels(guildId: number): Promise<void> {
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

    selectChannel(id: number): void {
      patchState(store, { selectedChannelId: id });
    },

    toggleCategory(categoryId: number): void {
      const current = store.collapsedCategories();
      patchState(store, {
        collapsedCategories: { ...current, [categoryId]: !current[categoryId] },
      });
    },

    addChannel(channel: Channel): void {
      const gid = channel.guildId;
      const existing = store.channelsByGuild()[gid] ?? [];
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

    removeChannel(channelId: number): void {
      const updated: Record<number, Channel[]> = {};
      for (const [gid, channels] of Object.entries(store.channelsByGuild())) {
        updated[Number(gid)] = channels.filter((c) => c.id !== channelId);
      }
      patchState(store, { channelsByGuild: updated });
    },
  })),
);
