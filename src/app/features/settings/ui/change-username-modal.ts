import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiModal } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Change-username flow: confirm your password, then rename. The rename broadcasts live to
 * guilds/friends/other tabs server-side (D19) — this modal just applies it to the local session
 * (auth.service.changeUsername already does that) and emits `done` so the parent closes + toasts.
 */
@Component({
  selector: 'app-change-username-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiButton, UiModal],
  template: `
    <ui-modal heading="Change Username" size="sm" (close)="close.emit()">
      <div class="px-6 pb-6">
        @if (error()) {
        <p class="mb-4 text-sm text-danger">{{ error() }}</p>
        }

        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          Password
        </label>
        <input
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="password()"
          (ngModelChange)="password.set($event)"
        />

        <div class="h-3"></div>

        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          New Username
        </label>
        <input
          type="text"
          autocomplete="username"
          minlength="2"
          maxlength="32"
          placeholder="new-username"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="newUsername()"
          (ngModelChange)="newUsername.set($event)"
          (keydown.enter)="submit()"
        />

        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
            (click)="submit()"
          >
            {{ submitting() ? 'Saving…' : 'Change Username' }}
          </ui-button>
        </div>
      </div>
    </ui-modal>
  `,
})
export class ChangeUsernameModal {
  private readonly auth = inject(AuthService);

  readonly close = output<void>();
  readonly done = output<void>();

  protected readonly password = signal('');
  protected readonly newUsername = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');

  protected readonly canSubmit = computed(
    () => !!this.password() && this.newUsername().length >= 2 && this.newUsername().length <= 32,
  );

  async submit(): Promise<void> {
    if (!this.canSubmit() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      await this.auth.changeUsername(this.password(), this.newUsername());
      this.done.emit();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
