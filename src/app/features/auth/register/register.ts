import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { GoogleSignInButton, UiButton, UiInput } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';
import { GoogleUsernameStep } from '../ui/google-username-step';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    UiButton,
    UiInput,
    GoogleSignInButton,
    GoogleUsernameStep,
  ],
  templateUrl: './register.html',
})
export class RegisterComponent {
  form: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);

  // Non-null once Google returns a verified identity with no account — the template swaps to the
  // username step. In-memory only; the ID token is never persisted.
  protected readonly pendingGoogleToken = signal<string | null>(null);
  protected readonly suggestedUsername = signal('');
  protected readonly googleEmail = signal('');
  protected readonly googleUsernameError = signal<string | null>(null);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      username: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(32),
          // Mirror ASP.NET Identity's default allowed username characters.
          Validators.pattern(/^[A-Za-z0-9._@+-]+$/),
        ],
      ],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    }, { validators: passwordMatchValidator });
  }

  protected async onGoogleCredential(idToken: string): Promise<void> {
    if (this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.authService.loginWithGoogle(idToken);
      if (result.needsUsername) {
        // Valid Google identity, no account yet — nothing has been created. Hold the token and
        // swap to the username step; the second call is what registers.
        this.pendingGoogleToken.set(idToken);
        this.suggestedUsername.set(result.suggestedUsername);
        this.googleEmail.set(result.email);
        return;
      }
      this.router.navigate(['/app']);
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Second leg of Google sign-up: same ID token, now with the chosen username. */
  protected async onGoogleUsername(username: string): Promise<void> {
    const idToken = this.pendingGoogleToken();
    if (!idToken || this.loading()) return;

    this.loading.set(true);
    this.googleUsernameError.set(null);
    try {
      await this.authService.loginWithGoogle(idToken, username);
      this.router.navigate(['/app']);
    } catch (err) {
      this.googleUsernameError.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected cancelGoogleSignup(): void {
    this.pendingGoogleToken.set(null);
    this.googleUsernameError.set(null);
    this.error.set(null);
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.register(
        this.form.value.username,
        this.form.value.email,
        this.form.value.password
      );
      this.router.navigate(['/app']);
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  get username() { return this.form.get('username')!; }
  get email() { return this.form.get('email')!; }
  get password() { return this.form.get('password')!; }
  get confirmPassword() { return this.form.get('confirmPassword')!; }
  get passwordMismatch() { return this.form.hasError('passwordMismatch') && this.confirmPassword.touched; }

  get usernameError(): string | null {
    if (!(this.username.invalid && this.username.touched)) return null;
    if (this.username.hasError('pattern')) {
      return 'Username can only use letters, numbers, and . _ - @ +';
    }
    return 'Username must be between 2 and 32 characters.';
  }
  get emailError(): string | null {
    return this.email.invalid && this.email.touched ? 'Enter a valid email address.' : null;
  }
  get passwordError(): string | null {
    return this.password.invalid && this.password.touched
      ? 'Password must be at least 8 characters.'
      : null;
  }
  get confirmPasswordError(): string | null {
    return this.passwordMismatch ? 'Passwords do not match.' : null;
  }
}