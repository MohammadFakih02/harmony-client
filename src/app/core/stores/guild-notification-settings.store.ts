import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import {
  GuildNotificationSettings,
  NotificationLevel,
} from '../models/notification-setting.models';
import { GuildNotificationSettingsService } from '../services/guild-notification-settings.service';

interface State {
  // Per-guild cache of the caller's notification settings.
  byGuild: Record<string, GuildNotificationSettings>;
}

export const GuildNotificationSettingsStore = signalStore(
  { providedIn: 'root' },
  withState<State>({ byGuild: {} }),
  withMethods((store, service = inject(GuildNotificationSettingsService)) => {
    const put = (guildId: string, settings: GuildNotificationSettings) =>
      patchState(store, { byGuild: { ...store.byGuild(), [guildId]: settings } });

    return {
      settingsOf(guildId: string): GuildNotificationSettings | null {
        return store.byGuild()[guildId] ?? null;
      },

      /** Always refetches — the page is opened on demand, so freshness beats cache here. */
      async load(guildId: string): Promise<void> {
        try {
          put(guildId, await service.get(guildId));
        } catch {
          // leave whatever was cached; the page shows a loading/empty state
        }
      },

      async setGuildLevel(guildId: string, level: NotificationLevel): Promise<void> {
        const current = store.byGuild()[guildId];
        if (current) put(guildId, { ...current, guildLevel: level }); // optimistic
        try {
          await service.setGuildLevel(guildId, level);
        } catch {
          await this.load(guildId); // revert from server
        }
      },

      /** Sets a per-channel override, or clears it (back to the guild level) when level is null. */
      async setChannelLevel(
        guildId: string,
        channelId: string,
        level: NotificationLevel | null,
      ): Promise<void> {
        const current = store.byGuild()[guildId];
        if (current) {
          const channels = current.channels.filter((c) => c.channelId !== channelId);
          if (level) channels.push({ channelId, level });
          put(guildId, { ...current, channels });
        }
        try {
          if (level) await service.setChannelLevel(guildId, channelId, level);
          else await service.resetChannelLevel(guildId, channelId);
        } catch {
          await this.load(guildId);
        }
      },
    };
  }),
);
