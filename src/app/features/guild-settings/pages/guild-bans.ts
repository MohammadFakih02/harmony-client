import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { MemberService } from '../../../core/services/member.service';
import { GuildBan } from '../../../core/models/member.models';

/**
 * Lists a guild's banned users with an unban action (BanMembers). A pane of the guild-settings
 * page (§5.24 admin-tools consolidation). Revoking a ban lets the user rejoin via an invite.
 */
@Component({
  selector: 'app-guild-bans',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar],
  template: `
    <h2 class="text-xl font-bold text-primary mb-1">Bans</h2>
    <p class="text-sm text-muted mb-5">Revoke a ban to let the user rejoin via an invite.</p>

    @if (error()) {
    <p class="text-sm text-danger mb-3">{{ error() }}</p>
    }

    @if (loading()) {
    <div class="flex justify-center py-10">
      <i class="fas fa-yin-yang animate-spin text-faint"></i>
    </div>
    } @else if (list().length === 0) {
    <p class="text-sm text-faint text-center py-10">No banned users.</p>
    } @else {
    <div class="flex flex-col gap-1">
      @for (ban of list(); track ban.userId) {
      <div class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2 transition-micro">
        <ui-avatar [src]="ban.avatarKey" [alt]="ban.username ?? 'Unknown'" size="sm" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium text-primary truncate">{{ ban.username ?? 'Unknown user' }}</span>
          @if (ban.reason) {
          <span class="text-xs text-faint truncate" [title]="ban.reason">{{ ban.reason }}</span>
          }
        </div>
        <button
          type="button"
          class="rounded-md bg-surface-3 px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-2 transition-micro disabled:opacity-50"
          [disabled]="busyId() === ban.userId"
          (click)="unban(ban.userId)"
        >
          Unban
        </button>
      </div>
      }
    </div>
    }
  `,
})
export class GuildBans implements OnInit {
  readonly guildId = input.required<string>();

  private readonly members = inject(MemberService);

  protected readonly list = signal<GuildBan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.list.set(await this.members.getBans(this.guildId()));
    } catch {
      this.error.set('Could not load bans.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async unban(userId: string): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(userId);
    try {
      await this.members.unban(this.guildId(), userId);
      this.list.set(this.list().filter((b) => b.userId !== userId));
    } catch {
      this.error.set('Could not unban this user.');
    } finally {
      this.busyId.set(null);
    }
  }
}
