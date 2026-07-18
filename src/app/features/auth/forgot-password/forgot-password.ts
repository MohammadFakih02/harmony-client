import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiInput } from '../../../shared/ui';

/**
 * Forgot-password request page. Always shows the same "check your email" success state on
 * submit, regardless of whether the address belongs to an account (D6 — the backend never
 * reveals account existence either, so there is nothing more specific to show).
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, UiButton, UiInput],
  templateUrl: './forgot-password.html',
})
export class ForgotPassword {
  form: FormGroup;
  loading = signal(false);
  protected readonly sent = signal(false);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    try {
      await this.authService.forgotPassword(this.form.value.email);
    } catch {
      // Swallow — never surface a send failure either, that would itself leak whether the
      // address exists (a real send error vs. "unknown email" are indistinguishable by design,
      // see AuthService.ForgotPasswordAsync).
    } finally {
      this.sent.set(true);
      this.loading.set(false);
    }
  }

  get email() {
    return this.form.get('email')!;
  }
  get emailError(): string | null {
    return this.email.invalid && this.email.touched ? 'Enter a valid email address.' : null;
  }
}
