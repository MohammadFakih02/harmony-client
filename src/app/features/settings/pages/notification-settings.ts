import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NotificationPreferenceStore } from '../../../core/stores/notification-preference.store';
import { NOTIFICATION_PREFERENCE_FIELDS } from '../../../core/models/notification-preference.models';
import { PushService } from '../../../core/services/push.service';
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

      <!-- Push is special: turning it on needs browser permission + a subscription,
           not just the server-side flag — so it bypasses the generic loop. -->
      <div>
        <app-settings-toggle
          [label]="pushField.label"
          [description]="pushField.description"
          [checked]="pushChecked(prefs.pushEnabled)"
          [disabled]="!push.isSupported"
          (toggled)="onPushToggle($event)"
        />
        @if (pushHint(); as hint) {
        <p class="text-xs text-warning pb-3">{{ hint }}</p>
        } @else if (!push.isSupported) {
        <p class="text-xs text-muted pb-3">
          Push notifications aren't supported in this browser.
        </p>
        }
      </div>
    </div>
    } @else {
    <p class="text-sm text-muted">Loading…</p>
    }
  `,
})
export class NotificationSettings implements OnInit {
  protected readonly store = inject(NotificationPreferenceStore);
  protected readonly push = inject(PushService);

  protected readonly fields = NOTIFICATION_PREFERENCE_FIELDS.filter(
    (f) => f.key !== 'pushEnabled',
  );
  protected readonly pushField = NOTIFICATION_PREFERENCE_FIELDS.find(
    (f) => f.key === 'pushEnabled',
  )!;

  protected readonly pushHint = signal<string | null>(null);
  /** Bumped after enable()/disable() so pushChecked re-evaluates the (non-reactive) permission. */
  private readonly permissionVersion = signal(0);

  ngOnInit(): void {
    if (!this.store.preferences()) void this.store.load();
  }

  /**
   * ON only when the server flag AND this browser's permission agree — the flag
   * defaults to true server-side, but without a granted permission + subscription
   * nothing would actually arrive here, so showing it checked would lie.
   */
  protected pushChecked(prefEnabled: boolean): boolean {
    this.permissionVersion();
    return prefEnabled && this.push.permission === 'granted';
  }

  protected async onPushToggle(value: boolean): Promise<void> {
    this.pushHint.set(null);

    if (!value) {
      void this.store.setFlag('pushEnabled', false);
      await this.push.disable();
      this.permissionVersion.update((v) => v + 1);
      return;
    }

    // This click is the user gesture the permission prompt needs — enable() is the
    // only place the app ever requests it.
    const result = await this.push.enable();
    this.permissionVersion.update((v) => v + 1);
    switch (result) {
      case 'enabled':
        void this.store.setFlag('pushEnabled', true);
        break;
      case 'denied':
        this.pushHint.set(
          'Notifications are blocked for this site — allow them in your browser settings, then try again.',
        );
        break;
      case 'unavailable':
        this.pushHint.set('Push notifications are not available right now.');
        break;
      case 'unsupported':
        break; // toggle is disabled in this state anyway
    }
  }
}
