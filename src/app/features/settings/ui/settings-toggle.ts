import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** A labelled on/off switch row used across the settings pages. */
@Component({
  selector: 'app-settings-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="flex w-full items-center gap-4 py-3 text-left"
      (click)="toggled.emit(!checked())"
    >
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold text-primary">{{ label() }}</span>
        @if (description()) {
        <span class="block text-xs text-muted mt-0.5">{{ description() }}</span>
        }
      </span>
      <span
        class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        [class.bg-accent]="checked()"
        [class.bg-surface-3]="!checked()"
      >
        <span
          class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          [class.translate-x-5]="checked()"
        ></span>
      </span>
    </button>
  `,
})
export class SettingsToggle {
  readonly label = input.required<string>();
  readonly description = input<string>('');
  readonly checked = input.required<boolean>();
  readonly toggled = output<boolean>();
}
