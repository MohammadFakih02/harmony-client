import { Component, OnDestroy, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { GoogleSignInButton, UiButton, UiInput } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, RouterLink, UiButton, UiInput, GoogleSignInButton],
  templateUrl: './login.html',
})
export class LoginComponent implements OnDestroy {
  form: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);

  // Non-null once the password step returns a 2FA challenge — the template swaps to the code step.
  protected readonly challengeToken = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly rememberDevice = signal(false);
  protected readonly verifying = signal(false);
  protected readonly resending = signal(false);
  protected readonly resendCooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.form = this.fb.group({
      // Email or username — no email-shape validator, since a username is also valid.
      identifier: ['', [Validators.required]],
      password: ['', [Validators.required]],
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.cooldownTimer);
  }

  protected async onGoogleCredential(idToken: string): Promise<void> {
    if (this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      await this.authService.loginWithGoogle(idToken);
      this.navigateAfterLogin();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.authService.login(
        this.form.value.identifier,
        this.form.value.password
      );
      if (result.twoFactorRequired) {
        this.challengeToken.set(result.challengeToken);
        this.startResendCooldown(); // the password step already emailed a first code
        return;
      }
      this.navigateAfterLogin();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onVerifyCode(): Promise<void> {
    const token = this.challengeToken();
    if (!token || this.code().length !== 6 || this.verifying()) return;

    this.verifying.set(true);
    this.error.set(null);
    try {
      await this.authService.verify2fa(token, this.code(), this.rememberDevice());
      this.navigateAfterLogin();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.verifying.set(false);
    }
  }

  protected async onResendCode(): Promise<void> {
    const token = this.challengeToken();
    if (!token || this.resending() || this.resendCooldown() > 0) return;

    this.resending.set(true);
    try {
      await this.authService.resend2fa(token);
      this.startResendCooldown();
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.resending.set(false);
    }
  }

  /** Backs out of the code step to the password form (e.g. the challenge expired). */
  protected backToPassword(): void {
    clearInterval(this.cooldownTimer);
    this.challengeToken.set(null);
    this.code.set('');
    this.rememberDevice.set(false);
    this.error.set(null);
  }

  private navigateAfterLogin(): void {
    // Honor a returnUrl (e.g. a shared /invite/:code link the guest was sent from).
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.router.navigateByUrl(returnUrl ?? '/app');
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

  get identifier() { return this.form.get('identifier')!; }
  get password() { return this.form.get('password')!; }

  get identifierError(): string | null {
    return this.identifier.invalid && this.identifier.touched ? 'Enter your email or username.' : null;
  }
  get passwordError(): string | null {
    return this.password.invalid && this.password.touched ? 'Enter your password.' : null;
  }
}