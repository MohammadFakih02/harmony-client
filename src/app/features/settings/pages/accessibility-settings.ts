import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LocalSettingsStore } from '../../../core/stores/local-settings.store';
import { SettingsToggle } from '../ui/settings-toggle';

@Component({
  selector: 'app-accessibility-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsToggle],
  template: `
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">Accessibility</h2>
      <p class="text-sm text-muted mt-1.5">Make Harmony easier to see, read, and navigate.</p>
    </header>

    <div class="set-card divide-y divide-border-subtle">
      <app-settings-toggle
        label="Reduced Motion"
        description="Minimise non-essential animations and transitions across the app."
        [checked]="settings.reducedMotion()"
        (toggled)="settings.setReducedMotion($event)"
      />
    </div>
  `,
})
export class AccessibilitySettings {
  protected readonly settings = inject(LocalSettingsStore);
}
