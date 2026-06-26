import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { MemberService } from '../../../core/services/member.service';
import { GuildBan } from '../../../core/models/member.models';

/**
 * Lists a guild's banned users with an unban action. Opened from the member-sidebar header when the
 * caller has BanMembers. Loads on open and emits `close`. (Will fold into the guild-settings page
 * once that exists — §5.24 batch E.)
 */
@Component({
  selector: 'app-bans-modal',
  standalone: true,
  imports: [UiAvatar],
  templateUrl: './bans-modal.html',
})
export class BansModal implements OnInit {
  private readonly members = inject(MemberService);

  readonly guildId = input.required<string>();
  readonly close = output<void>();

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
