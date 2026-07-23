import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ChannelService, DeletedChannel } from '../../../core/services/channel.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { ConfirmService } from '../../../shared/ui';

const RETENTION_DAYS = 30; // mirrors the backend TrashPurgeService window

/**
 * A guild's channel Trash (§5.71 #5, ManageChannels): soft-deleted channels with Restore and Delete
 * Forever. A channel sits here — messages preserved — until restored, permanently deleted, or the
 * 30-day auto-purge. A pane of the guild-settings page.
 */
@Component({
  selector: 'app-guild-trash',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="text-xl font-bold text-primary mb-1">Deleted Channels</h2>
    <p class="text-sm text-muted mb-5">
      Deleted channels are kept here for {{ retentionDays }} days — restore one to bring it (and its
      messages) back, or delete it forever now.
    </p>

    @if (error()) {
    <p class="text-sm text-danger mb-3">{{ error() }}</p>
    }

    @if (loading()) {
    <div class="flex justify-center py-10">
      <i class="fas fa-yin-yang animate-spin text-faint"></i>
    </div>
    } @else if (list().length === 0) {
    <p class="text-sm text-faint text-center py-10">Trash is empty.</p>
    } @else {
    <div class="flex flex-col gap-1">
      @for (channel of list(); track channel.id) {
      <div class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 transition-micro">
        <i
          class="fas w-4 text-center text-faint"
          [class.fa-hashtag]="channel.type === 'text'"
          [class.fa-volume-high]="channel.type === 'voice'"
        ></i>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium text-primary truncate">{{ channel.name }}</span>
          <span class="text-xs text-faint">{{ purgeHint(channel) }}</span>
        </div>
        <button
          type="button"
          class="rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-2 transition-micro disabled:opacity-50"
          [disabled]="busyId() === channel.id"
          (click)="restore(channel)"
        >
          Restore
        </button>
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 transition-micro disabled:opacity-50"
          [disabled]="busyId() === channel.id"
          (click)="permanentDelete(channel)"
        >
          Delete Forever
        </button>
      </div>
      }
    </div>
    }
  `,
})
export class GuildTrash implements OnInit {
  readonly guildId = input.required<string>();

  private readonly channels = inject(ChannelService);
  private readonly channelStore = inject(ChannelStore);
  private readonly confirm = inject(ConfirmService);

  protected readonly retentionDays = RETENTION_DAYS;
  protected readonly list = signal<DeletedChannel[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.list.set(await this.channels.getTrash(this.guildId()));
    } catch {
      this.error.set('Could not load deleted channels.');
    } finally {
      this.loading.set(false);
    }
  }

  /** "Auto-deletes in N days" (or "today"), from the 30-day window minus how long it's been trashed. */
  protected purgeHint(channel: DeletedChannel): string {
    const elapsedDays = Math.floor((Date.now() - channel.deletedAt) / 86_400_000);
    const remaining = Math.max(0, RETENTION_DAYS - elapsedDays);
    return remaining <= 0 ? 'Auto-deletes soon' : `Auto-deletes in ${remaining} day${remaining === 1 ? '' : 's'}`;
  }

  protected async restore(channel: DeletedChannel): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(channel.id);
    try {
      await this.channels.restore(this.guildId(), channel.id);
      this.list.set(this.list().filter((c) => c.id !== channel.id));
      // The server's ChannelUpdated broadcast only updates channels already in the (permission-
      // filtered) list — it can't add one back. Refetch the filtered list so the restored channel
      // reappears in this admin's sidebar (other members pick it up on their next guild load).
      void this.channelStore.loadChannels(this.guildId());
    } catch {
      this.error.set('Could not restore this channel.');
    } finally {
      this.busyId.set(null);
    }
  }

  protected async permanentDelete(channel: DeletedChannel): Promise<void> {
    if (this.busyId()) return;
    const ok = await this.confirm.confirm({
      title: 'Delete Channel Forever',
      message: `Permanently delete #${channel.name} and all its messages? This can't be undone.`,
      confirmLabel: 'Delete Forever',
      danger: true,
    });
    if (!ok) return;

    this.busyId.set(channel.id);
    try {
      await this.channels.permanentDelete(this.guildId(), channel.id);
      this.list.set(this.list().filter((c) => c.id !== channel.id));
    } catch {
      this.error.set('Could not delete this channel.');
    } finally {
      this.busyId.set(null);
    }
  }
}
