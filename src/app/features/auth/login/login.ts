import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { UiButton, UiInput } from '../../../shared/ui';
import { extractApiError } from '../../../shared/util/api-error';

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
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.form = this.fb.group({
      // Email or username — no email-shape validator, since a username is also valid.
      identifier: ['', [Validators.required]],
      password: ['', [Validators.required]],
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.login(
        this.form.value.identifier,
        this.form.value.password
      );
      // Honor a returnUrl (e.g. a shared /invite/:code link the guest was sent from).
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      this.router.navigateByUrl(returnUrl ?? '/app');
    } catch (err) {
      this.error.set(extractApiError(err));
    } finally {
      this.loading.set(false);
    }
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