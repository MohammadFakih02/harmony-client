import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { UserService } from '../../../core/services/user.service';
import { BlockStore } from '../../../core/stores/block.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { DmPrivacy } from '../../../core/models/user.models';
import { Mute } from '../../../core/models/mute.models';
import { UiAvatar, UiButton } from '../../../shared/ui';

@Component({
  selector: 'app-privacy-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar, UiButton],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Privacy &amp; Safety</h2>

    <!-- DM privacy -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Direct Messages</p>
    <div class="space-y-2 mb-8">
      @for (opt of dmOptions; track opt.value) {
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
        [class.border-accent]="dmPrivacy() === opt.value"
        [class.border-border-subtle]="dmPrivacy() !== opt.value"
        (click)="setDmPrivacy(opt.value)"
      >
        <span
          class="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2"
          [class.border-accent]="dmPrivacy() === opt.value"
          [class.bg-accent]="dmPrivacy() === opt.value"
          [class.border-faint]="dmPrivacy() !== opt.value"
        ></span>
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

  protected readonly dmPrivacy = signal<DmPrivacy>('everyone');

  protected readonly dmOptions: { value: DmPrivacy; label: string; description: string }[] = [
    { value: 'everyone', label: 'Everyone', description: 'Anyone can send you a direct message.' },
    {
      value: 'friends_only',
      label: 'Friends Only',
      description: 'Only friends can start a new conversation. Existing chats stay open.',
    },
  ];

  ngOnInit(): void {
    void this.users.getMe().then((me) => this.dmPrivacy.set(me.dmPrivacy));
    void this.blocks.load();
    void this.mutes.load();
  }

  protected async setDmPrivacy(value: DmPrivacy): Promise<void> {
    if (this.dmPrivacy() === value) return;
    const previous = this.dmPrivacy();
    this.dmPrivacy.set(value);
    try {
      await this.users.updateDmPrivacy(value);
    } catch {
      this.dmPrivacy.set(previous);
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
