import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiModal } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Change-email flow: confirm your password + the new address, then a confirmation link is
 * emailed to the NEW address — the account's email doesn't actually change until that link is
 * followed (D16), so there is no "done" event here, only a Resend + Close. For a 2FA-enabled
 * account, the first submit comes back requiresCode:true (D20) — the password/email fields stay
 * filled and a 6-digit emailed-code step appears in place before the actual confirmation link is
 * sent to the new address.
 */
@Component({
  selector: 'app-change-email-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiButton, UiModal],
  template: `
    <ui-modal heading="Change Email" size="sm" (close)="close.emit()">
      <div class="px-6 pb-6">
        @if (!sent()) {
        @if (error()) {
        <p class="mb-4 text-sm text-danger">{{ error() }}</p>
        }

        @if (!requiresCode()) {
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
          New Email
        </label>
        <input
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          class="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-primary placeholder-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          [ngModel]="newEmail()"
          (ngModelChange)="newEmail.set($event)"
          (keydown.enter)="send()"
        />

        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="sending()"
            [disabled]="!password() || !newEmail()"
            (click)="send()"
          >
            {{ sending() ? 'Sending…' : 'Send Confirmation Link' }}
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
          (keydown.enter)="send()"
        />
        <div class="pt-5">
          <ui-button
            type="button"
            variant="primary"
            [block]="true"
            [loading]="sending()"
            [disabled]="code().length !== 6"
            (click)="send()"
          >
            {{ sending() ? 'Confirming…' : 'Confirm' }}
          </ui-button>
        </div>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            class="text-sm text-accent-light hover:text-accent font-medium transition-colors disabled:opacity-50 disabled:hover:text-accent-light"
            [disabled]="sending() || resendCooldown() > 0"
            (click)="resendStepUpCode()"
          >
            @if (resendCooldown() > 0) { Resend code ({{ resendCooldown() }}s) }
            @else { Resend code }
          </button>
        </div>
        }
        } @else {
        <p class="text-sm text-muted">
          Check <span class="font-semibold text-primary">{{ newEmail() }}</span> — your email
          won't change until you confirm.
        </p>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            class="text-sm text-accent-light hover:text-accent font-medium transition-colors disabled:opacity-50 disabled:hover:text-accent-light"
            [disabled]="sending() || resendCooldown() > 0"
            (click)="send()"
          >
            @if (resendCooldown() > 0) { Resend link ({{ resendCooldown() }}s) }
            @else { Resend link }
          </button>
        </div>
        <div class="pt-5">
          <ui-button type="button" variant="ghost" [block]="true" (click)="close.emit()">
            Close
          </ui-button>
        </div>
        }
      </div>
    </ui-modal>
  `,
})
export class ChangeEmailModal {
  private readonly auth = inject(AuthService);

  readonly close = output<void>();

  protected readonly password = signal('');
  protected readonly newEmail = signal('');
  protected readonly code = signal('');
  protected readonly requiresCode = signal(false);
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');
  protected readonly resendCooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  async send(): Promise<void> {
    if (this.requiresCode()) {
      if (this.code().length !== 6 || this.sending()) return;
    } else if (!this.password() || !this.newEmail() || this.sending() || this.resendCooldown() > 0) {
      return;
    }

    this.sending.set(true);
    this.error.set('');
    try {
      const requiresCode = await this.auth.requestEmailChange(
        this.password(),
        this.newEmail(),
        this.requiresCode() ? this.code() : undefined,
      );
      if (requiresCode) {
        this.requiresCode.set(true);
        this.startResendCooldown();
        return;
      }

      clearInterval(this.cooldownTimer);
      this.sent.set(true);
      this.startResendCooldown();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.sending.set(false);
    }
  }

  async resendStepUpCode(): Promise<void> {
    if (this.sending() || this.resendCooldown() > 0) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.auth.requestEmailChange(this.password(), this.newEmail());
      this.startResendCooldown();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.sending.set(false);
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
