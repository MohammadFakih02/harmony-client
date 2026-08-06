import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiModal } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Change/Set Password: a Google-only account (hasPassword=false) skips the current-password
 * field entirely — the signed-in session is the proof of ownership (D15). For a 2FA-enabled
 * account, the first submit comes back requiresCode:true (D20) — the password/new-password
 * fields stay filled and a 6-digit emailed-code step appears in place, with Resend. Emits `done`
 * once the password actually changed; the parent closes + toasts.
 */
@Component({
  selector: 'app-change-password-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiButton, UiModal],
  template: `
    <ui-modal [heading]="heading()" size="sm" (close)="close.emit()">
      <div class="px-6 pb-6">
        @if (error()) {
        <p class="mb-4 text-sm text-danger">{{ error() }}</p>
        }

        @if (!requiresCode()) {
        @if (hasPassword()) {
        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          Current Password
        </label>
        <input
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="currentPassword()"
          (ngModelChange)="currentPassword.set($event)"
        />
        <div class="h-3"></div>
        }

        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          New Password
        </label>
        <input
          type="password"
          autocomplete="new-password"
          placeholder="••••••••"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="newPassword()"
          (ngModelChange)="newPassword.set($event)"
        />

        <div class="h-3"></div>

        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          Confirm New Password
        </label>
        <input
          type="password"
          autocomplete="new-password"
          placeholder="••••••••"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="confirmPassword()"
          (ngModelChange)="confirmPassword.set($event)"
          (keydown.enter)="submit()"
        />
        @if (confirmPassword() && newPassword() !== confirmPassword()) {
        <p class="text-2xs text-danger mt-1">Passwords don't match.</p>
        }

        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
            (click)="submit()"
          >
            {{ submitting() ? 'Saving…' : heading() }}
          </ui-button>
        </div>
        } @else {
        <p class="text-sm text-muted mb-4">
          Enter the 6-digit code we emailed you to confirm this change.
        </p>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          placeholder="000000"
          class="w-full text-center text-2xl font-mono tracking-[0.5em] px-4 py-3 rounded-lg bg-bg border border-border text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="code()"
          (ngModelChange)="code.set($event)"
          (keydown.enter)="submit()"
        />
        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="submitting()"
            [disabled]="code().length !== 6"
            (click)="submit()"
          >
            {{ submitting() ? 'Confirming…' : 'Confirm' }}
          </ui-button>
        </div>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            class="text-sm text-accent-light hover:text-accent font-medium transition-colors disabled:opacity-50 disabled:hover:text-accent-light"
            [disabled]="submitting() || resendCooldown() > 0"
            (click)="resend()"
          >
            @if (resendCooldown() > 0) { Resend code ({{ resendCooldown() }}s) }
            @else { Resend code }
          </button>
        </div>
        }
      </div>
    </ui-modal>
  `,
})
export class ChangePasswordModal {
  private readonly auth = inject(AuthService);

  readonly hasPassword = input.required<boolean>();
  readonly close = output<void>();
  readonly done = output<void>();

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly code = signal('');
  protected readonly requiresCode = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly resendCooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  protected readonly heading = computed(() =>
    this.hasPassword() ? 'Change Password' : 'Set Password',
  );

  protected readonly canSubmit = computed(() => {
    if (this.hasPassword() && !this.currentPassword()) return false;
    return this.newPassword().length >= 8 && this.newPassword() === this.confirmPassword();
  });

  async submit(): Promise<void> {
    if (this.requiresCode()) {
      if (this.code().length !== 6 || this.submitting()) return;
    } else if (!this.canSubmit() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    try {
      if (!this.hasPassword()) {
        await this.auth.setPassword(this.newPassword());
        this.done.emit();
        return;
      }

      const result = await this.auth.changePassword(
        this.currentPassword(),
        this.newPassword(),
        this.requiresCode() ? this.code() : undefined,
      );
      if (result.requiresCode) {
        this.requiresCode.set(true);
        this.startResendCooldown();
        return;
      }

      clearInterval(this.cooldownTimer);
      this.done.emit();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.submitting.set(false);
    }
  }

  async resend(): Promise<void> {
    if (this.submitting() || this.resendCooldown() > 0) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      await this.auth.changePassword(this.currentPassword(), this.newPassword());
      this.startResendCooldown();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private startResendCooldown(): void {
    this.resendCooldown.set(60);
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      const next = this.resendCooldown() - 1;
      if (next <= 0) {
        this.resendCooldown.set(0);
        clearInterval(this.cooldownTimer);
      } else {
        this.resendCooldown.set(next);
      }
    }, 1000);
  }
}
