import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiInput } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

type ResetState = 'form' | 'invalidLink' | 'success';

/**
 * Public landing page for the reset-password link (`/reset-password?uid=&token=`). Anonymous —
 * this browser may have no session at all, and resetting doesn't touch this browser's own
 * session even if one exists (it revokes every OTHER refresh token/trusted device server-side).
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, UiButton, UiInput],
  templateUrl: './reset-password.html',
})
export class ResetPassword implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  form: FormGroup;
  loading = signal(false);
  error = signal<string | null>(null);
  protected readonly state = signal<ResetState>('form');

  private uid = '';
  private token = '';

  constructor() {
    this.form = this.fb.group(
      {
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', Validators.required],
      },
      { validators: passwordMatchValidator },
    );
  }

  ngOnInit(): void {
    const uid = this.route.snapshot.queryParamMap.get('uid');
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!uid || !token) {
      this.state.set('invalidLink');
      return;
    }
    this.uid = uid;
    this.token = token;
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      await this.authService.resetPassword(this.uid, this.token, this.form.value.password);
      this.state.set('success');
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  get password() {
    return this.form.get('password')!;
  }
  get confirmPassword() {
    return this.form.get('confirmPassword')!;
  }
  get passwordMismatch() {
    return this.form.hasError('passwordMismatch') && this.confirmPassword.touched;
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
