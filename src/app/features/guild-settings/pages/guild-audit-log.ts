import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { AuditLogEntry, auditActionMeta } from '../../../core/models/audit-log.models';

/**
 * Read-only view of a guild's moderation history (ViewAuditLog). Entries are newest-first; the
 * "Load more" button pages older via the `before` keyset cursor. Each row shows the actor, a
 * human-readable action phrase, an optional reason, and the timestamp.
 */
@Component({
  selector: 'app-guild-audit-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  template: `
    <h2 class="text-xl font-bold text-primary mb-1">Audit Log</h2>
    <p class="text-sm text-muted mb-5">A record of moderation and management actions in this server.</p>

    @if (error()) {
    <p class="text-sm text-danger mb-3">{{ error() }}</p>
    }

    @if (loading() && entries().length === 0) {
    <div class="flex justify-center py-10">
      <i class="fas fa-yin-yang animate-spin text-faint"></i>
    </div>
    } @else if (entries().length === 0) {
    <p class="text-sm text-faint text-center py-10">No audit-log entries yet.</p>
    } @else {
    <div class="flex flex-col gap-1">
      @for (entry of entries(); track entry.id) {
      <div class="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2 transition-micro">
        <ui-avatar [src]="entry.actorAvatarKey" [alt]="entry.actorUsername ?? 'Unknown'" size="sm" />
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="text-sm text-primary">
            <i class="fas {{ meta(entry.actionType).icon }} mr-1.5 text-xs text-faint"></i>
            <span class="font-semibold">{{ entry.actorUsername ?? 'Unknown user' }}</span>
            <span class="text-muted"> {{ meta(entry.actionType).verb }}</span>
          </p>
          @if (entry.reason) {
          <p class="text-xs text-faint truncate" [title]="entry.reason">Reason: {{ entry.reason }}</p>
          }
        </div>
        <span class="shrink-0 text-2xs text-faint" [title]="fullTime(entry)">{{ shortTime(entry) }}</span>
      </div>
      }
    </div>

    @if (hasMore()) {
    <button
      type="button"
      class="mt-4 w-full rounded-lg py-2 text-sm text-muted hover:bg-surface-2 transition-micro disabled:opacity-50"
      [disabled]="loading()"
      (click)="loadMore()"
    >
      {{ loading() ? 'Loading…' : 'Load more' }}
    </button>
    }
    }
  `,
})
export class GuildAuditLog implements OnInit {
  readonly guildId = input.required<string>();

  private readonly service = inject(AuditLogService);

  protected readonly entries = signal<AuditLogEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly hasMore = signal(false);

  private static readonly PageSize = 50;

  protected readonly meta = auditActionMeta;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(before?: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.service.getAuditLog(this.guildId(), { before });
      this.entries.update((cur) => (before ? [...cur, ...page] : page));
      this.hasMore.set(page.length >= GuildAuditLog.PageSize);
    } catch {
      this.error.set('Could not load the audit log.');
    } finally {
      this.loading.set(false);
    }
  }

  protected loadMore(): void {
    const last = this.entries().at(-1);
    if (last) void this.load(last.id);
  }

  protected shortTime(entry: AuditLogEntry): string {
    return new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  protected fullTime(entry: AuditLogEntry): string {
    return new Date(entry.createdAt).toLocaleString();
  }
}
