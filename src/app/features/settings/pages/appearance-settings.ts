import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PALETTE_OPTIONS, ThemeService } from '../../../core/services/theme.service';
import { LocalSettingsStore } from '../../../core/stores/local-settings.store';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, MessageDisplay } from '../../../core/models/settings.models';

@Component({
  selector: 'app-appearance-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">Appearance</h2>
      <p class="text-sm text-muted mt-1.5">Personalize how Harmony looks on every screen.</p>
    </header>

    <!-- Colour palette -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Colour</p>
    <div class="grid grid-cols-3 gap-3 mb-8 max-md:grid-cols-1">
      @for (opt of palettes; track opt.id) {
      @let sel = theme.palette() === opt.id;
      <button
        type="button"
        class="relative flex flex-col items-start gap-2.5 rounded-xl border p-3.5 text-left transition-micro"
        [class.border-accent]="sel"
        [class.bg-accent-muted]="sel"
        [class.border-border-subtle]="!sel"
        [class.hover:border-border]="!sel"
        [class.hover:bg-surface-2]="!sel"
        (click)="theme.setPalette(opt.id)"
      >
        @if (sel) {
        <i class="fas fa-circle-check absolute top-2.5 right-2.5 text-accent text-sm"></i>
        }
        <span
          class="flex items-center justify-center w-9 h-9 rounded-full text-white shadow-sm"
          [style.background]="opt.swatch"
        >
          <i class="fas {{ opt.icon }} text-xs"></i>
        </span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-primary">{{ opt.label }}</span>
          <span class="block text-xs text-muted mt-0.5">{{ opt.description }}</span>
        </span>
      </button>
      }
    </div>

    <!-- Mode -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Mode</p>
    <div class="flex gap-3 mb-8">
      @for (m of modes; track m.value) {
      @let sel = theme.mode() === m.value;
      <button
        type="button"
        class="flex-1 flex items-center gap-3 rounded-xl border p-3.5 text-left transition-micro"
        [class.border-accent]="sel"
        [class.bg-accent-muted]="sel"
        [class.border-border-subtle]="!sel"
        [class.hover:border-border]="!sel"
        [class.hover:bg-surface-2]="!sel"
        (click)="theme.setMode(m.value)"
      >
        <i
          class="fas {{ m.icon }} text-lg w-5 text-center"
          [class.text-accent]="sel"
          [class.text-muted]="!sel"
        ></i>
        <span class="text-sm font-semibold text-primary flex-1">{{ m.label }}</span>
        @if (sel) {
        <i class="fas fa-circle-check text-accent text-sm"></i>
        }
      </button>
      }
    </div>

    <!-- Message display -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Message Display</p>
    <div class="flex gap-3 mb-8">
      @for (mode of displays; track mode.value) {
      @let sel = settings.messageDisplay() === mode.value;
      <button
        type="button"
        class="relative flex-1 rounded-xl border p-3.5 text-left transition-micro"
        [class.border-accent]="sel"
        [class.bg-accent-muted]="sel"
        [class.border-border-subtle]="!sel"
        [class.hover:border-border]="!sel"
        [class.hover:bg-surface-2]="!sel"
        (click)="settings.setMessageDisplay(mode.value)"
      >
        @if (sel) {
        <i class="fas fa-circle-check absolute top-3 right-3 text-accent text-sm"></i>
        }
        <span class="block text-sm font-semibold text-primary">{{ mode.label }}</span>
        <span class="block text-xs text-muted mt-0.5">{{ mode.description }}</span>
      </button>
      }
    </div>

    <!-- Font scale -->
    <div class="flex items-baseline justify-between mb-2">
      <p class="text-2xs font-bold uppercase tracking-wider text-faint">Font Scale</p>
      <span class="text-xs font-semibold text-accent tabular-nums">{{ (settings.fontScale() * 100).toFixed(0) }}%</span>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs text-faint select-none">A</span>
      <input
        type="range"
        class="flex-1 accent-accent"
        aria-label="Font scale"
        [min]="min"
        [max]="max"
        step="0.05"
        [value]="settings.fontScale()"
        (input)="onScale($event)"
      />
      <span class="text-lg text-faint select-none">A</span>
    </div>
  `,
})
export class AppearanceSettings {
  protected readonly theme = inject(ThemeService);
  protected readonly settings = inject(LocalSettingsStore);
  protected readonly palettes = PALETTE_OPTIONS;
  protected readonly min = FONT_SCALE_MIN;
  protected readonly max = FONT_SCALE_MAX;

  protected readonly displays: { value: MessageDisplay; label: string; description: string }[] = [
    { value: 'cozy', label: 'Cozy', description: 'Roomy, with avatars and spacing.' },
    { value: 'compact', label: 'Compact', description: 'Denser rows, more on screen.' },
  ];

  protected readonly modes: { value: 'dark' | 'light'; label: string; icon: string }[] = [
    { value: 'dark', label: 'Dark', icon: 'fa-moon' },
    { value: 'light', label: 'Light', icon: 'fa-sun' },
  ];

  protected onScale(event: Event): void {
    this.settings.setFontScale(Number((event.target as HTMLInputElement).value));
  }
}
