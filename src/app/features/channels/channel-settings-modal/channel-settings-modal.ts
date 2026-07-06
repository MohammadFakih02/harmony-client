import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Channel } from '../../../core/models/channel.models';
import { ChannelStore } from '../../../core/stores/channel.store';

/** Slowmode presets (seconds) offered in the editor — 0 = off, Discord's ladder. */
const SLOWMODE_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Off', seconds: 0 },
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
];

/**
 * Channel settings editor (ManageChannels) — name, topic, NSFW flag, and slowmode. A focused modal
 * opened from the channel right-click menu; text channels only (voice channels have no topic/slowmode
 * surface yet). Saves through ChannelStore.saveChannel; the ChannelUpdated broadcast reconciles other
 * clients.
 */
@Component({
  selector: 'app-channel-settings-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      (click)="close.emit()"
    >
      <div
        class="bg-surface rounded-xl shadow-modal border border-border w-full max-w-md mx-4 p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-2">
          <i class="fas fa-hashtag text-faint"></i>
          <h2 class="text-lg font-bold text-primary">Edit Channel</h2>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Channel Name</label>
          <input
            type="text"
            maxlength="100"
            class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            (keydown.enter)="save()"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Channel Topic</label>
          <textarea
            rows="3"
            maxlength="1024"
            placeholder="What is this channel about?"
            class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro resize-none"
            [ngModel]="topic()"
            (ngModelChange)="topic.set($event)"
          ></textarea>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Slowmode</label>
          <div class="flex flex-wrap gap-1.5">
            @for (opt of slowmodeOptions; track opt.seconds) {
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-medium border transition-micro"
              [class.bg-accent]="slowmode() === opt.seconds"
              [class.text-white]="slowmode() === opt.seconds"
              [class.border-accent]="slowmode() === opt.seconds"
              [class.border-border-subtle]="slowmode() !== opt.seconds"
              [class.text-muted]="slowmode() !== opt.seconds"
              [class.hover:bg-surface-2]="slowmode() !== opt.seconds"
              (click)="slowmode.set(opt.seconds)"
            >
              {{ opt.label }}
            </button>
            }
          </div>
          <p class="text-2xs text-faint">
            Members can send one message per interval. Moderators are exempt.
          </p>
        </div>

        <button
          type="button"
          class="flex items-center justify-between gap-3 rounded-lg bg-surface-2 border border-border-subtle px-3.5 py-3 text-left transition-micro hover:bg-surface-3"
          (click)="isNsfw.set(!isNsfw())"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-primary">Age-Restricted Channel (NSFW)</p>
            <p class="text-2xs text-faint mt-0.5">
              Users must confirm they're of age before viewing this channel.
            </p>
          </div>
          <span
            class="relative w-9 h-5 rounded-full transition-micro shrink-0"
            [class.bg-accent]="isNsfw()"
            [class.bg-surface-3]="!isNsfw()"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              [class.translate-x-4]="isNsfw()"
            ></span>
          </span>
        </button>

        @if (error()) {
        <p class="text-xs text-danger">{{ error() }}</p>
        }

        <div class="flex gap-2 justify-end pt-1">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition-micro"
            (click)="close.emit()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-micro"
            [disabled]="saving() || !name().trim() || !dirty()"
            (click)="save()"
          >
            {{ saving() ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ChannelSettingsModal {
  readonly channel = input.required<Channel>();
  readonly close = output<void>();

  private readonly channelStore = inject(ChannelStore);

  protected readonly slowmodeOptions = SLOWMODE_OPTIONS;

  protected readonly name = signal('');
  protected readonly topic = signal('');
  protected readonly isNsfw = signal(false);
  protected readonly slowmode = signal(0);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly dirty = computed(() => {
    const c = this.channel();
    return (
      this.name().trim() !== c.name ||
      this.topic() !== (c.topic ?? '') ||
      this.isNsfw() !== c.isNsfw ||
      this.slowmode() !== c.slowmodeSeconds
    );
  });

  constructor() {
    // Seed the form from the channel input once it's set (inputs are available in the field
    // initializer order after construction, so read it lazily via an effect-free assignment here).
    queueMicrotask(() => {
      const c = this.channel();
      this.name.set(c.name);
      this.topic.set(c.topic ?? '');
      this.isNsfw.set(c.isNsfw);
      this.slowmode.set(c.slowmodeSeconds);
    });
  }

  protected async save(): Promise<void> {
    const c = this.channel();
    const name = this.name().trim();
    if (!name || this.saving() || !this.dirty()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.channelStore.saveChannel(c.guildId!, c.id, {
        name,
        topic: this.topic().trim() || null,
        isNsfw: this.isNsfw(),
        slowmodeSeconds: this.slowmode(),
      });
      this.close.emit();
    } catch {
      this.error.set('Could not save the channel. Check your permissions.');
    } finally {
      this.saving.set(false);
    }
  }
}
