import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiInput } from '../../../shared/ui';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, UiButton, UiInput],
  templateUrl: './login.html',
})
export class LoginComponent {
  form: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.login(
        this.form.value.email,
        this.form.value.password
      );
      this.router.navigate(['/app']);
    } catch (err: any) {
      this.error.set(
        err?.error?.error ?? 'Something went wrong. Please try again.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  get email() { return this.form.get('email')!; }
  get password() { return this.form.get('password')!; }

  get emailError(): string | null {
    return this.email.invalid && this.email.touched ? 'Enter a valid email address.' : null;
  }
  get passwordError(): string | null {
    return this.password.invalid && this.password.touched ? 'Password must be at least 8 characters.' : null;
  }
}