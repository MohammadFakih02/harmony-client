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
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">Welcome</h2>
      <p class="text-sm text-muted mt-1.5">Greet new members the moment they join your server.</p>
    </header>

    <div class="set-card">
      <app-settings-toggle
        label="Member join messages"
        description="Post a notice when someone joins this server."
        [checked]="systemMessagesEnabled()"
        (toggled)="systemMessagesEnabled.set($event)"
      />
    </div>

    @if (systemMessagesEnabled()) {
    <div class="set-card p-4 mt-4 flex flex-col gap-4">
      <div>
        <label class="set-section-label" for="welcome-channel">Welcome Channel</label>
        <select
          id="welcome-channel"
          class="mt-1.5 w-full rounded-lg bg-surface border border-border-subtle px-3 py-2 text-sm text-primary outline-none focus:border-accent transition-micro"
          [value]="welcomeChannelId() ?? 'default'"
          (change)="onChannelChange($any($event.target).value)"
        >
          <option value="default">Default (first text channel)</option>
          @for (ch of textChannels(); track ch.id) {
          <option [value]="ch.id">#{{ ch.name }}</option>
          }
        </select>
      </div>
      <div>
        <label class="set-section-label" for="welcome-message">Welcome Message</label>
        <textarea
          id="welcome-message"
          class="mt-1.5 w-full resize-none rounded-lg bg-surface border border-border-subtle px-3 py-2 text-sm text-primary outline-none focus:border-accent transition-micro"
          rows="3"
          maxlength="2000"
          placeholder="Leave blank for a default join notice."
          [(ngModel)]="welcomeMessage"
        ></textarea>
      </div>
    </div>
    }

    <div class="mt-6 flex items-center gap-3">
      <button
        type="button"
        class="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50 transition-micro"
        [disabled]="!dirty() || saving()"
        (click)="save()"
      >
        {{ saving() ? 'Saving…' : 'Save Changes' }}
      </button>
      @if (dirty()) {
      <button type="button" class="text-sm text-muted hover:text-primary transition-micro" (click)="reset()">
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
