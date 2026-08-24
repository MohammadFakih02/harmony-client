import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { GuildSummary } from '../models/guild.models';
import { LoadStatus } from '../models/load-status';
import { GuildService } from '../services/guild.service';
import { ToastService } from '../services/toast.service';

interface GuildState {
  guilds: GuildSummary[];
  selectedGuildId: string | null;
  loading: boolean;
  // Read-status of the guild-rail load (audit A12): lets the shell tell a genuinely empty account
  // apart from a failed boot, so it can offer a retry instead of a false-blank rail.
  status: LoadStatus;
}

export const GuildStore = signalStore(
  { providedIn: 'root' },
  withState<GuildState>({ guilds: [], selectedGuildId: null, loading: false, status: 'idle' }),
  withComputed(({ guilds, selectedGuildId }) => ({
    selectedGuild: computed(() => guilds().find((g) => g.id === selectedGuildId()) ?? null),
  })),
  withMethods((store, service = inject(GuildService), toast = inject(ToastService)) => ({
    async loadGuilds(): Promise<void> {
      patchState(store, { loading: true, status: 'loading' });
      try {
        const guilds = await service.getMyGuilds();
        patchState(store, { guilds, loading: false, status: 'loaded' });
      } catch {
        // Preserve any previously-loaded guilds; flag the error so the shell can offer a retry
        // rather than rendering an empty rail as if the account genuinely had no servers.
        patchState(store, { loading: false, status: 'error' });
      }
    },

    /** Replaces the guild list (bootstrap payload distribution — no fetch). */
    setGuilds(guilds: GuildSummary[]): void {
      patchState(store, { guilds, loading: false, status: 'loaded' });
    },

    /** Drag-reorder the rail: optimistic move + persist the full order. Reverts on failure. */
    async reorderGuilds(previousIndex: number, currentIndex: number): Promise<void> {
      if (previousIndex === currentIndex) return;
      const previous = store.guilds();
      const next = [...previous];
      const [moved] = next.splice(previousIndex, 1);
      if (!moved) return;
      next.splice(currentIndex, 0, moved);
      patchState(store, { guilds: next });
      try {
        await service.updateGuildOrder(next.map((g) => g.id));
      } catch {
        patchState(store, { guilds: previous });
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
      const name = store.guilds().find((g) => g.id === guildId)?.name ?? 'Server';
      await service.deleteGuild(guildId);
      patchState(store, {
        guilds: store.guilds().filter((g) => g.id !== guildId),
        selectedGuildId: store.selectedGuildId() === guildId ? null : store.selectedGuildId(),
      });
      // Soft delete — reassure the owner it's recoverable and link straight to the Trash pane.
      toast.action(`${name} moved to Trash`, 'Restore it from Settings → Trash', 'fa-trash-can', ['/app/settings'], {
        queryParams: { tab: 'trash' },
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
