import { Injectable, signal, computed } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";
import { PushService } from "./push.service";

export interface User {
  id: string;
  username: string;
  email: string;
  avatarKey: string | null;
  accountStatus: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

// The flat, additive shape /auth/login and /auth/2fa/verify both return (backend D3): a non-2FA
// login has accessToken/user populated and twoFactorRequired false; a 2FA-gated login has only
// twoFactorRequired + challengeToken populated.
interface LoginResponseDto {
  accessToken: string | null;
  user: User | null;
  twoFactorRequired: boolean;
  challengeToken: string | null;
}

export type LoginResult =
  | { twoFactorRequired: false }
  | { twoFactorRequired: true; challengeToken: string };

// /auth/google reuses LoginResponseDto and adds a third outcome: the token is valid but no account
// exists yet, so the caller must supply a username before anything is created.
interface GoogleLoginResponseDto extends LoginResponseDto {
  needsUsername: boolean;
  suggestedUsername: string | null;
  email: string | null;
}

export type GoogleLoginResult =
  | { needsUsername: false }
  | { needsUsername: true; suggestedUsername: string; email: string };

// Change-password's response shape (D20): mirrors LoginResponseDto's discriminated pattern. A
// 2FA-enabled account's first call (no code yet) comes back requiresCode:true with nothing else
// populated — the password was verified, but the change itself is on hold until the emailed
// step-up code is resubmitted.
interface ChangePasswordResponseDto {
  requiresCode: boolean;
  accessToken: string | null;
  user: User | null;
}

export type ChangePasswordResult = { requiresCode: true } | { requiresCode: false };

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly _accessToken = signal<string | null>(null);
  private readonly _currentUser = signal<User | null>(null);

  // Public readonly signals — components read these directly
  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this._accessToken() !== null);
  readonly accessToken = this._accessToken.asReadonly();

  private refreshPromise: Promise<boolean> | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    private push: PushService,
  ) {}

  async register(
    username: string,
    email: string,
    password: string,
  ): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(
        `${environment.apiUrl}/auth/register`,
        {
          username,
          email,
          password,
        },
        { withCredentials: true },
      ), // withCredentials so the httpOnly cookie is set
    );
    this.setSession(response);
  }

  // identifier is the user's email OR username — the backend resolves either. Returns a
  // discriminated result rather than throwing: "needs a 2FA code" is a normal outcome, not a
  // failure — the caller (the login page) branches on twoFactorRequired to show the challenge step.
  async login(identifier: string, password: string): Promise<LoginResult> {
    const response = await firstValueFrom(
      this.http.post<LoginResponseDto>(
        `${environment.apiUrl}/auth/login`,
        {
          identifier,
          password,
        },
        { withCredentials: true },
      ),
    );
    if (response.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: response.challengeToken! };
    }
    this.setSession({ accessToken: response.accessToken!, user: response.user! });
    return { twoFactorRequired: false };
  }

  /** Completes a login challenge with the emailed code. rememberDevice asks the server to also
   * set a 30-day "trusted_device" cookie so future logins from this browser skip the challenge. */
  async verify2fa(challengeToken: string, code: string, rememberDevice: boolean): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(
        `${environment.apiUrl}/auth/2fa/verify`,
        { challengeToken, code, rememberDevice },
        { withCredentials: true },
      ),
    );
    this.setSession(response);
  }

  /** Signs in (or auto-links by verified email) from a Google Identity Services ID token. Never
   * returns a 2FA challenge, even if the linked account has 2FA enabled — Google is the trust
   * anchor on this path.
   *
   * Returns a discriminated result rather than throwing, like login(): when the token is valid but
   * matches no account, needsUsername comes back true and NOTHING has been created server-side —
   * no user row, no session. The caller shows a username step and calls this again with the SAME
   * idToken plus the chosen name, which is the call that actually registers the account. */
  async loginWithGoogle(idToken: string, username?: string): Promise<GoogleLoginResult> {
    const response = await firstValueFrom(
      this.http.post<GoogleLoginResponseDto>(
        `${environment.apiUrl}/auth/google`,
        { idToken, username: username ?? null },
        { withCredentials: true },
      ),
    );
    if (response.needsUsername) {
      return {
        needsUsername: true,
        suggestedUsername: response.suggestedUsername ?? '',
        email: response.email ?? '',
      };
    }
    this.setSession({ accessToken: response.accessToken!, user: response.user! });
    return { needsUsername: false };
  }

  /** Resends the login-challenge code. Always resolves — a genuine send failure surfaces as a
   * thrown error (502); an expired/unknown challenge or an active cooldown are silent no-ops. */
  async resend2fa(challengeToken: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${environment.apiUrl}/auth/2fa/resend`,
        { challengeToken },
        { withCredentials: true },
      ),
    );
  }

  /** Starts the enable-2FA flow: verifies the password and emails a setup code. */
  async enable2faRequest(password: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/2fa/enable/request`, { password }),
    );
  }

  /** Confirms the emailed setup code and turns 2FA on. */
  async enable2faConfirm(code: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/2fa/enable/confirm`, { code }),
    );
    this.patchCurrentUser({ twoFactorEnabled: true });
  }

  /** Verifies the password, turns 2FA off, and revokes every trusted device. */
  async disable2fa(password: string): Promise<void> {
    await firstValueFrom(this.http.post(`${environment.apiUrl}/auth/2fa/disable`, { password }));
    this.patchCurrentUser({ twoFactorEnabled: false });
  }

  /** "Require 2FA on all devices again" — revokes every trusted device without disabling 2FA. */
  async clearTrustedDevices(): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/auth/2fa/trusted-devices`));
  }

  async logout(): Promise<void> {
    // Tear down this browser's push subscription BEFORE we drop the session, so a
    // logged-out browser stops receiving pushes (a killed endpoint 410s server-side
    // and gets pruned). Best-effort — disable() swallows its own errors and must
    // never block logout.
    await this.push.disable().catch(() => {});
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/auth/logout`,
          {},
          { withCredentials: true },
        ),
      );
    } finally {
      // Always clear local state even if the request fails
      this.clearSession();
      this.router.navigate(["/login"]);
    }
  }

  // Called by the HTTP interceptor when it receives a 401.
  // Returns true if refresh succeeded, false if the user needs to log in again.
  // Deduplicates concurrent refresh attempts — only one request goes out even if
  // multiple requests 401 at the same time.
  async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this._doRefresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async _doRefresh(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<AuthResponse>(
          `${environment.apiUrl}/auth/refresh`,
          {},
          {
            withCredentials: true, // sends the httpOnly refresh_token cookie
          },
        ),
      );
      this.setSession(response);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  private sessionChecked = false;
  private sessionValid = false;
  // Called on app startup to restore session if a refresh token cookie exists.
  // Returns true if session was restored, false if the user needs to log in.
  async tryRestoreSession(): Promise<boolean> {
    if (this.sessionChecked) return this.sessionValid;

    const result = await this.refresh();
    this.sessionChecked = true;
    this.sessionValid = result;
    return result;
  }

  getAccessToken(): string | null {
    return this._accessToken();
  }

  /** Applies a partial update to the in-memory current user (e.g. a fresh avatarKey after upload). */
  patchCurrentUser(patch: Partial<User>): void {
    this._currentUser.update((u) => (u ? { ...u, ...patch } : u));
  }

  /** (Re)sends the verification email to the signed-in user's own address. Always resolves —
   * the backend no-ops silently when already verified or on cooldown. */
  async requestEmailVerification(): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/verify-email/request`, {}),
    );
  }

  /** Confirms an email via the link's uid/token pair. Works whether or not the browser has an
   * active session (the endpoint is anonymous — the link may be opened in a fresh browser). */
  async confirmEmail(userId: string, token: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/verify-email/confirm`, {
        userId,
        token,
      }),
    );
    // If this browser also happens to be signed in as that user, reflect the change locally
    // without a full refetch.
    if (this._currentUser()?.id === userId) {
      this.patchCurrentUser({ emailVerified: true });
    }
  }

  /** Always resolves — the backend never reveals whether the email belongs to an account. */
  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/forgot-password`, { email }),
    );
  }

  /** Resets the password via the link's uid/token pair. Anonymous — this browser may not have an
   * active session at all. On success, every other session (and any remembered 2FA device) dies
   * server-side; this browser's own local session (if any) is left untouched. */
  async resetPassword(userId: string, token: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/reset-password`, {
        userId,
        token,
        newPassword,
      }),
    );
  }

  // --- Credential changes (Stage E) ---

  /** Changes the password. For a 2FA-enabled account, the first call (no code) returns
   * requiresCode:true and changes nothing — the caller must resubmit with the emailed step-up
   * code. Otherwise (2FA disabled, or a valid code was supplied), every other session (and any
   * remembered 2FA device) dies server-side and this browser gets a fresh session so the caller
   * stays signed in. */
  async changePassword(
    currentPassword: string,
    newPassword: string,
    code?: string,
  ): Promise<ChangePasswordResult> {
    const response = await firstValueFrom(
      this.http.post<ChangePasswordResponseDto>(
        `${environment.apiUrl}/auth/change-password`,
        { currentPassword, newPassword, code: code ?? null },
        { withCredentials: true },
      ),
    );
    if (response.requiresCode) {
      return { requiresCode: true };
    }
    this.setSession({ accessToken: response.accessToken!, user: response.user! });
    return { requiresCode: false };
  }

  /** Adds a local password to a passwordless (Google-only) account. No current-password field —
   * the signed-in session is the proof of ownership. */
  async setPassword(newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/set-password`, { newPassword }),
    );
    this.patchCurrentUser({ hasPassword: true });
  }

  /** Verifies the password, then — for a 2FA-enabled account, on the first call (no code) —
   * returns true (requiresCode) without sending anything yet. Otherwise (2FA disabled, or a
   * valid code was supplied) emails a confirmation link to the NEW address — the old email stays
   * active until that link is followed — and returns false. */
  async requestEmailChange(password: string, newEmail: string, code?: string): Promise<boolean> {
    const response = await firstValueFrom(
      this.http.post<{ requiresCode: boolean }>(
        `${environment.apiUrl}/auth/change-email/request`,
        { password, newEmail, code: code ?? null },
      ),
    );
    return response.requiresCode;
  }

  /** Confirms an email change via the link's uid/email/token. Anonymous — a mail client may not
   * carry the session. If this browser also happens to be signed in as that user, reflect the
   * new email locally without a full refetch. */
  async confirmEmailChange(userId: string, email: string, token: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/change-email/confirm`, {
        userId,
        email,
        token,
      }),
    );
    if (this._currentUser()?.id === userId) {
      this.patchCurrentUser({ email });
    }
  }

  /** Verifies the password and renames the user. Other tabs/sessions pick up the new name live
   * via the ProfileUpdated gateway event; this call patches the local session directly. */
  async changeUsername(password: string, newUsername: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiUrl}/auth/change-username`, { password, newUsername }),
    );
    this.patchCurrentUser({ username: newUsername });
  }

  private setSession(response: AuthResponse): void {
    this._accessToken.set(response.accessToken);
    this._currentUser.set(response.user);
    // Keep the restore latch in sync — a fresh session is a known-valid result,
    // so a later guard check short-circuits without firing another refresh.
    this.sessionChecked = true;
    this.sessionValid = true;
  }

  private clearSession(): void {
    this._accessToken.set(null);
    this._currentUser.set(null);
    // After an intentional logout, lock the latch to "checked + invalid"
    // so guestGuard's tryRestoreSession() short-circuits instead of
    // re-running refresh() while the cookie is still technically alive.
    this.sessionChecked = true; // ← was false
    this.sessionValid = false;
  }
}
