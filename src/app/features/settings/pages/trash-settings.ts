import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { GuildService, DeletedGuild } from '../../../core/services/guild.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { UiAvatar, ConfirmService } from '../../../shared/ui';

const RETENTION_DAYS = 30; // mirrors the backend TrashPurgeService window

/**
 * Global server Trash (§5.71 #5): servers the user owns and has deleted, with Restore and Delete
 * Forever. A deleted server drops off the rail, so this Settings pane is where its owner brings it
 * back — restoring re-adds it to the rail live. Servers auto-purge after 30 days.
 */
@Component({
  selector: 'app-trash-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  template: `
    <h2 class="text-xl font-bold text-primary mb-1">Trash</h2>
    <p class="text-sm text-muted mb-5">
      Servers you delete are kept here for {{ retentionDays }} days — restore one to bring it and
      everything in it back, or delete it forever now.
    </p>

    @if (error()) {
    <p class="text-sm text-danger mb-3">{{ error() }}</p>
    }

    @if (loading()) {
    <div class="flex justify-center py-10">
      <i class="fas fa-yin-yang animate-spin text-faint"></i>
    </div>
    } @else if (list().length === 0) {
    <p class="text-sm text-faint text-center py-10">No deleted servers.</p>
    } @else {
    <div class="flex flex-col gap-1">
      @for (guild of list(); track guild.id) {
      <div class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 transition-micro">
        <ui-avatar [src]="guild.iconKey" [alt]="guild.name" size="sm" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium text-primary truncate">{{ guild.name }}</span>
          <span class="text-xs text-faint">{{ purgeHint(guild) }}</span>
        </div>
        <button
          type="button"
          class="rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-2 transition-micro disabled:opacity-50"
          [disabled]="busyId() === guild.id"
          (click)="restore(guild)"
        >
          Restore
        </button>
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 transition-micro disabled:opacity-50"
          [disabled]="busyId() === guild.id"
          (click)="permanentDelete(guild)"
        >
          Delete Forever
        </button>
      </div>
      }
    </div>
    }
  `,
})
export class TrashSettings implements OnInit {
  private readonly guilds = inject(GuildService);
  private readonly guildStore = inject(GuildStore);
  private readonly confirm = inject(ConfirmService);

  protected readonly retentionDays = RETENTION_DAYS;
  protected readonly list = signal<DeletedGuild[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.list.set(await this.guilds.getTrash());
    } catch {
      this.error.set('Could not load deleted servers.');
    } finally {
      this.loading.set(false);
    }
  }

  /** "Auto-deletes in N days", from the 30-day window minus how long it's been trashed. */
  protected purgeHint(guild: DeletedGuild): string {
    const elapsedDays = Math.floor((Date.now() - guild.deletedAt) / 86_400_000);
    const remaining = Math.max(0, RETENTION_DAYS - elapsedDays);
    return remaining <= 0 ? 'Auto-deletes soon' : `Auto-deletes in ${remaining} day${remaining === 1 ? '' : 's'}`;
  }

  protected async restore(guild: DeletedGuild): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(guild.id);
    try {
      const restored = await this.guilds.restoreGuild(guild.id);
      this.guildStore.addGuild(restored); // back on the rail immediately
      this.list.set(this.list().filter((g) => g.id !== guild.id));
    } catch {
      this.error.set('Could not restore this server.');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async permanentDelete(guild: DeletedGuild): Promise<void> {
    if (this.busyId()) return;
    const ok = await this.confirm.confirm({
      title: 'Delete Server Forever',
      message: `Permanently delete ${guild.name} and everything in it? This can't be undone.`,
      confirmLabel: 'Delete Forever',
      danger: true,
    });
    if (!ok) return;

    this.busyId.set(guild.id);
    try {
      await this.guilds.permanentDeleteGuild(guild.id);
      this.list.set(this.list().filter((g) => g.id !== guild.id));
    } catch {
      this.error.set('Could not delete this server.');
    } finally {
      this.busyId.set(null);
    }
  }
}
