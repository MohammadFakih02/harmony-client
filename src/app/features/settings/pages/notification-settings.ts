import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { NotificationPreferenceStore } from '../../../core/stores/notification-preference.store';
import { NOTIFICATION_PREFERENCE_FIELDS } from '../../../core/models/notification-preference.models';
import { SettingsToggle } from '../ui/settings-toggle';

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsToggle],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Notifications</h2>

    @if (store.preferences(); as prefs) {
    <div class="divide-y divide-border-subtle">
      @for (field of fields; track field.key) {
      <app-settings-toggle
        [label]="field.label"
        [description]="field.description"
        [checked]="prefs[field.key]"
        (toggled)="store.setFlag(field.key, $event)"
      />
      }
    </div>
    } @else {
    <p class="text-sm text-muted">Loading…</p>
    }
  `,
})
export class NotificationSettings implements OnInit {
  protected readonly store = inject(NotificationPreferenceStore);
  protected readonly fields = NOTIFICATION_PREFERENCE_FIELDS;

  ngOnInit(): void {
    if (!this.store.preferences()) void this.store.load();
  }
}
