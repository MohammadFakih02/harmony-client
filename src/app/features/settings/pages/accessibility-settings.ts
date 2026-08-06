import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LocalSettingsStore } from '../../../core/stores/local-settings.store';
import { SettingsToggle } from '../ui/settings-toggle';

@Component({
  selector: 'app-accessibility-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsToggle],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Accessibility</h2>

    <div class="divide-y divide-border-subtle">
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
