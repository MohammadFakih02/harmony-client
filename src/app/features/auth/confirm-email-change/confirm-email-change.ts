import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { extractApiError } from '../../../shared/util/api-error';

type ConfirmState = 'verifying' | 'success' | 'error';

/**
 * Public landing page for the change-email confirmation link
 * (`/confirm-email-change?uid=&email=&token=`). Works whether or not the browser has an active
 * session — the confirm endpoint is anonymous, since the link is opened from an email client that
 * may carry no session at all. If a session for that exact user does exist, AuthService patches
 * the email locally so the account-settings page reflects it without a refetch.
 */
@Component({
  selector: 'app-confirm-email-change',
  standalone: true,
  templateUrl: './confirm-email-change.html',
})
export class ConfirmEmailChange implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<ConfirmState>('verifying');
  protected readonly error = signal('');
  protected readonly email = signal('');

  async ngOnInit(): Promise<void> {
    const uid = this.route.snapshot.queryParamMap.get('uid');
    const email = this.route.snapshot.queryParamMap.get('email');
    const token = this.route.snapshot.queryParamMap.get('token');
    this.email.set(email ?? '');

    if (!uid || !email || !token) {
      this.error.set('This confirmation link is invalid.');
      this.state.set('error');
      return;
    }

    try {
      await this.auth.confirmEmailChange(uid, email, token);
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
