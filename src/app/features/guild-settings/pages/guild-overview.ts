import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GuildStore } from '../../../core/stores/guild.store';
import { GuildService } from '../../../core/services/guild.service';
import { SettingsToggle } from '../../settings/ui/settings-toggle';

/** Admin Overview: rename, describe, and toggle public discoverability. ManageGuild-gated by the shell. */
@Component({
  selector: 'app-guild-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SettingsToggle],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Overview</h2>

    <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">Server Name</label>
    <input
      class="mb-4 w-full rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
      [(ngModel)]="name"
      maxlength="100"
    />

    <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">Description</label>
    <textarea
      class="mb-2 w-full resize-none rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
      rows="3"
      [(ngModel)]="description"
    ></textarea>

    <div class="border-t border-border-subtle mt-2">
      <app-settings-toggle
        label="Public Server"
        description="Allow this server to be discovered publicly."
        [checked]="isPublic()"
        (toggled)="isPublic.set($event)"
      />
    </div>

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
export class GuildOverview implements OnInit {
  readonly guildId = input.required<string>();

  private readonly guildStore = inject(GuildStore);
  private readonly guildService = inject(GuildService);

  private readonly guild = computed(() =>
    this.guildStore.guilds().find((g) => g.id === this.guildId()) ?? null,
  );

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isPublic = signal(false);
  protected readonly saving = signal(false);

  protected readonly dirty = computed(() => {
    const g = this.guild();
    if (!g) return false;
    return (
      this.name() !== g.name ||
      this.description() !== (g.description ?? '') ||
      this.isPublic() !== g.isPublic
    );
  });

  // Seed from the guild in ngOnInit, not the constructor: the required `guildId` input
  // isn't bound yet at construction, so reading it there throws NG0950 and blanks the tab.
  ngOnInit(): void {
    this.reset();
  }

  protected reset(): void {
    const g = this.guild();
    if (!g) return;
    this.name.set(g.name);
    this.description.set(g.description ?? '');
    this.isPublic.set(g.isPublic);
  }

  protected async save(): Promise<void> {
    if (!this.dirty()) return;
    this.saving.set(true);
    try {
      const updated = await this.guildService.updateGuild(this.guildId(), {
        name: this.name().trim(),
        description: this.description().trim() || null,
        isPublic: this.isPublic(),
      });
      this.guildStore.applyGuildUpdate(updated);
    } finally {
      this.saving.set(false);
    }
  }
}
