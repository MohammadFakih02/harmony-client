import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { extractApiError } from '../../../shared/util/api-error';

type VerifyState = 'verifying' | 'success' | 'error';

/**
 * Public landing page for the verification-email link (`/verify-email?uid=&token=`). Works
 * whether or not the browser has an active session — the confirm endpoint is anonymous, so this
 * page never guards on auth. If a session for that exact user does exist, AuthService patches
 * `emailVerified` locally so the account-settings nag disappears without a refetch.
 */
@Component({
  selector: 'app-verify-email',
  standalone: true,
  templateUrl: './verify-email.html',
})
export class VerifyEmail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<VerifyState>('verifying');
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const uid = this.route.snapshot.queryParamMap.get('uid');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!uid || !token) {
      this.error.set('This verification link is invalid.');
      this.state.set('error');
      return;
    }

    try {
      await this.auth.confirmEmail(uid, token);
      this.state.set('success');
    } catch (e: unknown) {
      this.error.set(extractApiError(e));
      this.state.set('error');
    }
  }

  continue(): void {
    this.router.navigate([this.auth.isAuthenticated() ? '/app' : '/login']);
  }
}
