import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Channel } from '../../../core/models/channel.models';
import {
  NOTIFICATION_LEVEL_DEFAULT,
  NOTIFICATION_LEVEL_OPTIONS,
  NotificationLevel,
} from '../../../core/models/notification-setting.models';
import { GuildNotificationSettingsStore } from '../../../core/stores/guild-notification-settings.store';

/**
 * The caller's per-guild + per-channel notification levels. The guild level is the baseline; each
 * text channel can override it or fall back to "Use server default". This is a personal preference
 * (everyone sees it), distinct from the admin-only Overview/Welcome panes.
 */
@Component({
  selector: 'app-guild-notifications',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="text-xl font-bold text-primary mb-1">Notification Settings</h2>
    <p class="text-sm text-muted mb-5">Choose what notifies you in this server.</p>

    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Server default</p>
    <div class="flex flex-col gap-1 mb-7">
      @for (opt of levels; track opt.value) {
      <button
        type="button"
        class="flex items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors hover:bg-surface-3"
        [class.bg-surface-3]="guildLevel() === opt.value"
        (click)="store.setGuildLevel(guildId(), opt.value)"
      >
        <span
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
          [class.border-accent]="guildLevel() === opt.value"
          [class.border-faint]="guildLevel() !== opt.value"
        >
          @if (guildLevel() === opt.value) {
          <span class="h-2 w-2 rounded-full bg-accent"></span>
          }
        </span>
        <span class="text-primary">{{ opt.label }}</span>
      </button>
      }
    </div>

    <label
      class="flex items-center gap-3 rounded px-3 py-2.5 mb-7 cursor-pointer hover:bg-surface-3"
    >
      <input
        type="checkbox"
        class="accent-accent h-4 w-4"
        [checked]="guildSuppressEveryone()"
        (change)="onGuildSuppressChange($any($event.target).checked)"
      />
      <span class="flex-1 min-w-0">
        <span class="block text-sm text-primary">Suppress &#64;everyone and &#64;here</span>
        <span class="block text-2xs text-muted">
          &#64;everyone / &#64;here won't notify you. Direct &#64;mentions still do.
        </span>
      </span>
    </label>

    @if (textChannels().length) {
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Channel overrides</p>
    <div class="divide-y divide-border-subtle">
      @for (ch of textChannels(); track ch.id) {
      <div class="flex items-center gap-3 py-2.5">
        <i class="fas fa-hashtag text-faint text-xs"></i>
        <span class="flex-1 min-w-0 truncate text-sm text-primary">{{ ch.name }}</span>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm font-semibold transition-colors"
          [class.bg-accent]="channelSuppress(ch.id)"
          [class.text-white]="channelSuppress(ch.id)"
          [class.bg-surface-3]="!channelSuppress(ch.id)"
          [class.text-faint]="!channelSuppress(ch.id)"
          [attr.aria-label]="
            (channelSuppress(ch.id) ? 'Allow' : 'Suppress') + ' @everyone in #' + ch.name
          "
          [attr.aria-pressed]="channelSuppress(ch.id)"
          [title]="
            channelSuppress(ch.id)
              ? '@everyone suppressed in this channel'
              : 'Suppress @everyone in this channel'
          "
          (click)="onChannelSuppressToggle(ch.id)"
        >
          &#64;
        </button>
        <select
          class="rounded bg-surface-3 px-2 py-1 text-sm text-primary outline-none"
          [attr.aria-label]="'Notification level for #' + ch.name"
          [value]="channelLevel(ch.id) ?? 'default'"
          (change)="onChannelChange(ch.id, $any($event.target).value)"
        >
          <option value="default">Use server default</option>
          @for (opt of levels; track opt.value) {
          <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
      </div>
      }
    </div>
    }
  `,
})
export class GuildNotifications {
  readonly guildId = input.required<string>();
  readonly textChannels = input.required<Channel[]>();

  protected readonly store = inject(GuildNotificationSettingsStore);
  protected readonly levels = NOTIFICATION_LEVEL_OPTIONS;

  protected readonly settings = computed(() => this.store.settingsOf(this.guildId()));
  protected readonly guildLevel = computed<NotificationLevel>(
    () => this.settings()?.guildLevel ?? NOTIFICATION_LEVEL_DEFAULT,
  );
  protected readonly guildSuppressEveryone = computed<boolean>(
    () => this.settings()?.guildSuppressEveryone ?? false,
  );

  protected channelLevel(channelId: string): NotificationLevel | null {
    return this.settings()?.channels.find((c) => c.channelId === channelId)?.level ?? null;
  }

  protected channelSuppress(channelId: string): boolean {
    return this.settings()?.channels.find((c) => c.channelId === channelId)?.suppressEveryone ?? false;
  }

  protected onChannelChange(channelId: string, value: string): void {
    const level = value === 'default' ? null : (value as NotificationLevel);
    void this.store.setChannelLevel(this.guildId(), channelId, level);
  }

  protected onGuildSuppressChange(value: boolean): void {
    void this.store.setGuildSuppressEveryone(this.guildId(), value);
  }

  protected onChannelSuppressToggle(channelId: string): void {
    void this.store.setChannelSuppressEveryone(this.guildId(), channelId, !this.channelSuppress(channelId));
  }
}
