import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { THEME_OPTIONS, ThemeService } from '../../../core/services/theme.service';
import { LocalSettingsStore } from '../../../core/stores/local-settings.store';
import { FONT_SCALE_MAX, FONT_SCALE_MIN, MessageDisplay } from '../../../core/models/settings.models';

@Component({
  selector: 'app-appearance-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Appearance</h2>

    <!-- Theme -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Theme</p>
    <div class="grid grid-cols-2 gap-3 mb-8">
      @for (opt of themes; track opt.id) {
      <button
        type="button"
        class="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
        [class.border-accent]="theme.current() === opt.id"
        [class.border-border-subtle]="theme.current() !== opt.id"
        (click)="theme.setTheme(opt.id)"
      >
        <i class="fas {{ opt.icon }} text-lg text-muted w-5 text-center"></i>
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-primary">{{ opt.label }}</span>
          <span class="block text-xs text-muted truncate">{{ opt.description }}</span>
        </span>
      </button>
      }
    </div>

    <!-- Message display -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Message Display</p>
    <div class="flex gap-3 mb-8">
      @for (mode of displays; track mode.value) {
      <button
        type="button"
        class="flex-1 rounded-lg border p-3 text-left transition-colors"
        [class.border-accent]="settings.messageDisplay() === mode.value"
        [class.border-border-subtle]="settings.messageDisplay() !== mode.value"
        (click)="settings.setMessageDisplay(mode.value)"
      >
        <span class="block text-sm font-semibold text-primary">{{ mode.label }}</span>
        <span class="block text-xs text-muted mt-0.5">{{ mode.description }}</span>
      </button>
      }
    </div>

    <!-- Font scale -->
    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">
      Font Scale — {{ (settings.fontScale() * 100).toFixed(0) }}%
    </p>
    <input
      type="range"
      class="w-full accent-accent"
      [min]="min"
      [max]="max"
      step="0.05"
      [value]="settings.fontScale()"
      (input)="onScale($event)"
    />
  `,
})
export class AppearanceSettings {
  protected readonly theme = inject(ThemeService);
  protected readonly settings = inject(LocalSettingsStore);
  protected readonly themes = THEME_OPTIONS;
  protected readonly min = FONT_SCALE_MIN;
  protected readonly max = FONT_SCALE_MAX;

  protected readonly displays: { value: MessageDisplay; label: string; description: string }[] = [
    { value: 'cozy', label: 'Cozy', description: 'Roomy, with avatars and spacing.' },
    { value: 'compact', label: 'Compact', description: 'Denser rows, more on screen.' },
  ];

  protected onScale(event: Event): void {
    this.settings.setFontScale(Number((event.target as HTMLInputElement).value));
  }
}
