import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiInput } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, UiButton, UiInput],
  templateUrl: './register.html',
})
export class RegisterComponent {
  form: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(32)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    }, { validators: passwordMatchValidator });
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
    return this.username.invalid && this.username.touched
      ? 'Username must be between 2 and 32 characters.'
      : null;
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