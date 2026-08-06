import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiModal } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Enable-2FA flow: confirm your current password, then confirm the emailed 6-digit setup code.
 * Emits `enabled` once TwoFactorEnabled is actually flipped on (auth.service already patches
 * currentUser() internally — this is just the signal for the parent to close + toast).
 */
@Component({
  selector: 'app-enable-2fa-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiButton, UiModal],
  template: `
    <ui-modal heading="Enable Two-Factor Authentication" size="sm" (close)="close.emit()">
      <div class="px-6 pb-6">
        @if (error()) {
        <p class="mb-4 text-sm text-danger">{{ error() }}</p>
        }

        @if (!codeSent()) {
        <!-- Step 1: confirm password -->
        <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
          Current Password
        </label>
        <input
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="password()"
          (ngModelChange)="password.set($event)"
          (keydown.enter)="sendCode()"
        />
        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="sending()"
            [disabled]="!password()"
            (click)="sendCode()"
          >
            {{ sending() ? 'Sending…' : 'Send Code' }}
          </ui-button>
        </div>
        } @else {
        <!-- Step 2: confirm the emailed code -->
        <p class="text-sm text-muted mb-4">
          Enter the 6-digit code we emailed you to turn on two-factor authentication.
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
          (keydown.enter)="confirmCode()"
        />
        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="confirming()"
            [disabled]="code().length !== 6"
            (click)="confirmCode()"
          >
            {{ confirming() ? 'Confirming…' : 'Confirm' }}
          </ui-button>
        </div>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            class="text-sm text-accent-light hover:text-accent font-medium transition-colors disabled:opacity-50 disabled:hover:text-accent-light"
            [disabled]="sending() || resendCooldown() > 0"
            (click)="sendCode()"
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
export class Enable2faModal {
  private readonly auth = inject(AuthService);

  readonly close = output<void>();
  readonly enabled = output<void>();

  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly codeSent = signal(false);
  protected readonly sending = signal(false);
  protected readonly confirming = signal(false);
  protected readonly error = signal('');
  protected readonly resendCooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  async sendCode(): Promise<void> {
    if (!this.password() || this.sending() || this.resendCooldown() > 0) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.auth.enable2faRequest(this.password());
      this.codeSent.set(true);
      this.startResendCooldown();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.sending.set(false);
    }
  }

  async confirmCode(): Promise<void> {
    if (this.code().length !== 6 || this.confirming()) return;
    this.confirming.set(true);
    this.error.set('');
    try {
      await this.auth.enable2faConfirm(this.code());
      clearInterval(this.cooldownTimer);
      this.enabled.emit();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.confirming.set(false);
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
