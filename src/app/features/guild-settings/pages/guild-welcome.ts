import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Channel } from '../../../core/models/channel.models';
import { GuildStore } from '../../../core/stores/guild.store';
import { GuildService } from '../../../core/services/guild.service';
import { SettingsToggle } from '../../settings/ui/settings-toggle';

/**
 * Admin Welcome config: toggle member-join system messages, pick the welcome channel (defaults to the
 * first text channel) and an optional greeting. ManageGuild-gated by the shell.
 */
@Component({
  selector: 'app-guild-welcome',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SettingsToggle],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Welcome</h2>

    <div class="border-t border-border-subtle">
      <app-settings-toggle
        label="Member join messages"
        description="Post a notice when someone joins this server."
        [checked]="systemMessagesEnabled()"
        (toggled)="systemMessagesEnabled.set($event)"
      />
    </div>

    @if (systemMessagesEnabled()) {
    <div class="mt-4">
      <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
        Welcome Channel
      </label>
      <select
        class="mb-4 w-full rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
        [value]="welcomeChannelId() ?? 'default'"
        (change)="onChannelChange($any($event.target).value)"
      >
        <option value="default">Default (first text channel)</option>
        @for (ch of textChannels(); track ch.id) {
        <option [value]="ch.id">#{{ ch.name }}</option>
        }
      </select>

      <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
        Welcome Message
      </label>
      <textarea
        class="w-full resize-none rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
        rows="3"
        maxlength="2000"
        placeholder="Leave blank for a default join notice."
        [(ngModel)]="welcomeMessage"
      ></textarea>
    </div>
    }

    <div class="mt-6 flex items-center gap-3">
      <button
        type="button"
        class="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        [disabled]="!dirty() || saving()"
        (click)="save()"
      >
        {{ saving() ? 'Saving…' : 'Save Changes' }}
      </button>
      @if (dirty()) {
      <button type="button" class="text-sm text-muted hover:text-primary" (click)="reset()">
        Reset
      </button>
      }
    </div>
  `,
})
export class GuildWelcome implements OnInit {
  readonly guildId = input.required<string>();
  readonly textChannels = input.required<Channel[]>();

  private readonly guildStore = inject(GuildStore);
  private readonly guildService = inject(GuildService);

  private readonly guild = computed(() =>
    this.guildStore.guilds().find((g) => g.id === this.guildId()) ?? null,
  );

  protected readonly systemMessagesEnabled = signal(true);
  protected readonly welcomeChannelId = signal<string | null>(null);
  protected readonly welcomeMessage = signal('');
  protected readonly saving = signal(false);

  protected readonly dirty = computed(() => {
    const g = this.guild();
    if (!g) return false;
    return (
      this.systemMessagesEnabled() !== g.systemMessagesEnabled ||
      this.welcomeChannelId() !== g.welcomeChannelId ||
      this.welcomeMessage() !== (g.welcomeMessage ?? '')
    );
  });

  // Seed from the guild in ngOnInit, not the constructor: the required `guildId` input
  // isn't bound yet at construction, so reading it there throws NG0950 and blanks the tab.
  ngOnInit(): void {
    this.reset();
  }

  protected onChannelChange(value: string): void {
    this.welcomeChannelId.set(value === 'default' ? null : value);
  }

  protected reset(): void {
    const g = this.guild();
    if (!g) return;
    this.systemMessagesEnabled.set(g.systemMessagesEnabled);
    this.welcomeChannelId.set(g.welcomeChannelId);
    this.welcomeMessage.set(g.welcomeMessage ?? '');
  }

  protected async save(): Promise<void> {
    if (!this.dirty()) return;
    this.saving.set(true);
    try {
      const updated = await this.guildService.updateWelcome(this.guildId(), {
        welcomeChannelId: this.welcomeChannelId(),
        welcomeMessage: this.welcomeMessage().trim() || null,
        systemMessagesEnabled: this.systemMessagesEnabled(),
      });
      this.guildStore.applyGuildUpdate(updated);
    } finally {
      this.saving.set(false);
    }
  }
}
