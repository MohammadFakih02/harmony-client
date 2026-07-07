import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { UserService } from '../../../core/services/user.service';
import { BlockStore } from '../../../core/stores/block.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { DM_AUDIENCE_OPTIONS, DmAudience, parseDmAudiences } from '../../../core/models/user.models';
import { Mute } from '../../../core/models/mute.models';
import { UiAvatar, UiButton } from '../../../shared/ui';

@Component({
  selector: 'app-privacy-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar, UiButton],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Privacy &amp; Safety</h2>

    <!-- DM privacy — a checklist, not a radio: any combination of audiences may DM you.
         "Everyone" subsumes the other two, so picking it visually checks + locks them. -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-1">Who Can Send You a DM</p>
    <p class="text-xs text-muted mb-2">
      Existing conversations always stay open, regardless of this setting.
    </p>
    <div class="space-y-2 mb-8">
      @for (opt of dmOptions; track opt.value) {
      @let checked = isChecked(opt.value);
      @let locked = opt.value !== 'everyone' && audiences().has('everyone');
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
        [class.border-accent]="checked"
        [class.border-border-subtle]="!checked"
        [class.opacity-60]="locked"
        [disabled]="locked"
        (click)="toggle(opt.value)"
      >
        <span
          class="mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center"
          [class.border-accent]="checked"
          [class.bg-accent]="checked"
          [class.border-faint]="!checked"
        >
          @if (checked) {
          <i class="fas fa-check text-3xs text-white"></i>
          }
        </span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-primary">{{ opt.label }}</span>
          <span class="block text-xs text-muted mt-0.5">{{ opt.description }}</span>
        </span>
      </button>
      }
    </div>

    <!-- Blocked users -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">
      Blocked Users — {{ blocks.blocked().length }}
    </p>
    @if (blocks.blocked().length === 0) {
    <p class="text-sm text-muted mb-8">You haven't blocked anyone.</p>
    } @else {
    <div class="divide-y divide-border-subtle mb-8">
      @for (u of blocks.blocked(); track u.id) {
      <div class="flex items-center gap-3 py-2.5">
        <ui-avatar [src]="u.avatarKey" [alt]="u.username" size="sm" />
        <span class="flex-1 min-w-0 text-sm font-semibold text-primary truncate">{{ u.username }}</span>
        <ui-button variant="ghost" size="sm" (click)="blocks.unblock(u.id)">Unblock</ui-button>
      </div>
      }
    </div>
    }

    <!-- Muted -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">
      Muted — {{ mutes.mutes().length }}
    </p>
    @if (mutes.mutes().length === 0) {
    <p class="text-sm text-muted">Nothing is muted.</p>
    } @else {
    <div class="divide-y divide-border-subtle">
      @for (m of mutes.mutes(); track m.targetType + m.targetId) {
      <div class="flex items-center gap-3 py-2.5">
        <i class="fas {{ muteIcon(m) }} text-muted w-5 text-center"></i>
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-semibold text-primary">{{ muteLabel(m) }}</span>
          <span class="block text-xs text-muted">{{ muteUntil(m) }}</span>
        </span>
        <ui-button variant="ghost" size="sm" (click)="mutes.remove(m.targetType, m.targetId)">
          Unmute
        </ui-button>
      </div>
      }
    </div>
    }
  `,
})
export class PrivacySettings implements OnInit {
  private readonly users = inject(UserService);
  protected readonly blocks = inject(BlockStore);
  protected readonly mutes = inject(MuteStore);

  protected readonly audiences = signal<Set<DmAudience>>(new Set(['everyone']));
  protected readonly dmOptions = DM_AUDIENCE_OPTIONS;

  ngOnInit(): void {
    void this.users.getMe().then((me) => this.audiences.set(parseDmAudiences(me.dmPrivacy)));
    void this.blocks.load();
    void this.mutes.load();
  }

  protected isChecked(value: DmAudience): boolean {
    const set = this.audiences();
    return set.has(value) || (value !== 'everyone' && set.has('everyone'));
  }

  protected async toggle(value: DmAudience): Promise<void> {
    const previous = this.audiences();
    // "Everyone" subsumes friends/guild_members — locked while it's checked (click Everyone
    // itself to uncheck it first, mirroring the disabled state shown on the other two rows).
    if (value !== 'everyone' && previous.has('everyone')) return;

    // An empty result is a legitimate (if extreme) choice — "no one may start a new
    // conversation with me"; existing conversations are unaffected regardless.
    const next = new Set(previous);
    if (next.has(value)) next.delete(value);
    else next.add(value);

    this.audiences.set(next);
    try {
      await this.users.updateDmPrivacy([...next]);
    } catch {
      this.audiences.set(previous);
    }
  }

  protected muteIcon(m: Mute): string {
    return m.targetType === 'guild' ? 'fa-server' : m.targetType === 'channel' ? 'fa-hashtag' : 'fa-user';
  }

  protected muteLabel(m: Mute): string {
    const noun = m.targetType === 'guild' ? 'Server' : m.targetType === 'channel' ? 'Channel' : 'User';
    return `${noun} muted`;
  }

  protected muteUntil(m: Mute): string {
    return m.mutedUntil ? `Until ${new Date(m.mutedUntil).toLocaleString()}` : 'Muted indefinitely';
  }
}
