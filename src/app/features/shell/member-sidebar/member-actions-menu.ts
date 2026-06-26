import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemberStore } from '../../../core/stores/member.store';
import { GuildCapabilities, GuildMember } from '../../../core/models/member.models';

interface TimeoutOption {
  label: string;
  seconds: number;
}

/**
 * Moderation action menu for a single guild member (kick / ban / timeout), rendered inside the
 * member-sidebar's CDK overlay. Each action is shown only if the caller holds the matching
 * capability; kick/ban require a confirm step (ban takes an optional reason). Calls MemberStore
 * directly and emits `close` once an action succeeds or the user backs out.
 */
@Component({
  selector: 'app-member-actions-menu',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './member-actions-menu.html',
  host: { class: 'block' },
})
export class MemberActionsMenu {
  private readonly memberStore = inject(MemberStore);

  readonly guildId = input.required<string>();
  readonly member = input.required<GuildMember>();
  readonly caps = input.required<GuildCapabilities>();
  readonly close = output<void>();

  protected readonly view = signal<'root' | 'timeout' | 'kick' | 'ban'>('root');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly banReason = signal('');

  protected readonly timeoutOptions: TimeoutOption[] = [
    { label: '60 seconds', seconds: 60 },
    { label: '5 minutes', seconds: 300 },
    { label: '10 minutes', seconds: 600 },
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '1 week', seconds: 604800 },
  ];

  protected readonly isTimedOut = computed(() => {
    const until = this.member().communicationDisabledUntil;
    return until != null && until > Date.now();
  });

  protected readonly name = computed(() => this.member().nickname ?? this.member().username);

  private async run(action: Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action;
      this.close.emit();
    } catch {
      this.error.set('Action failed. Check your permissions and try again.');
      this.busy.set(false);
    }
  }

  protected applyTimeout(seconds: number): void {
    this.run(this.memberStore.timeout(this.guildId(), this.member().userId, seconds));
  }

  protected removeTimeout(): void {
    this.run(this.memberStore.clearTimeout(this.guildId(), this.member().userId));
  }

  protected kick(): void {
    this.run(this.memberStore.kick(this.guildId(), this.member().userId));
  }

  protected ban(): void {
    const reason = this.banReason().trim();
    this.run(this.memberStore.ban(this.guildId(), this.member().userId, reason || null));
  }
}
