import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { GuildSummary } from '../models/guild.models';
import { GuildService } from '../services/guild.service';

interface GuildState {
  guilds: GuildSummary[];
  selectedGuildId: string | null;
  loading: boolean;
}

export const GuildStore = signalStore(
  { providedIn: 'root' },
  withState<GuildState>({ guilds: [], selectedGuildId: null, loading: false }),
  withComputed(({ guilds, selectedGuildId }) => ({
    selectedGuild: computed(() => guilds().find((g) => g.id === selectedGuildId()) ?? null),
  })),
  withMethods((store, service = inject(GuildService)) => ({
    async loadGuilds(): Promise<void> {
      patchState(store, { loading: true });
      try {
        const guilds = await service.getMyGuilds();
        patchState(store, { guilds, loading: false });
      } catch {
        patchState(store, { loading: false });
      }
    },

    selectGuild(id: string): void {
      patchState(store, { selectedGuildId: id });
    },

    addGuild(guild: GuildSummary): void {
      patchState(store, { guilds: [...store.guilds(), guild] });
    },

    /** Drops a guild from local state (left, kicked, or banned). Clears the selection if it was active. */
    removeGuild(guildId: string): void {
      patchState(store, {
        guilds: store.guilds().filter((g) => g.id !== guildId),
        selectedGuildId: store.selectedGuildId() === guildId ? null : store.selectedGuildId(),
      });
    },

    async createGuild(name: string, description?: string): Promise<GuildSummary> {
      const guild = await service.createGuild(name, description);
      patchState(store, { guilds: [...store.guilds(), guild] });
      return guild;
    },

    /** Leave a guild (non-owner) then drop it from local state. */
    async leaveGuild(guildId: string): Promise<void> {
      await service.leaveGuild(guildId);
      patchState(store, {
        guilds: store.guilds().filter((g) => g.id !== guildId),
        selectedGuildId: store.selectedGuildId() === guildId ? null : store.selectedGuildId(),
      });
    },

    /** Delete a guild (owner only) then drop it from local state. */
    async deleteGuild(guildId: string): Promise<void> {
      await service.deleteGuild(guildId);
      patchState(store, {
        guilds: store.guilds().filter((g) => g.id !== guildId),
        selectedGuildId: store.selectedGuildId() === guildId ? null : store.selectedGuildId(),
      });
    },

    /** Replace a guild in local state after an update (Overview/Welcome edit). No-op if unknown. */
    applyGuildUpdate(guild: GuildSummary): void {
      patchState(store, {
        guilds: store.guilds().map((g) => (g.id === guild.id ? guild : g)),
      });
    },
  })),
);
