import { Injectable, signal, computed } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";

export interface User {
  id: string;
  username: string;
  discriminator: string | null;
  email: string;
  avatarKey: string | null;
  accountStatus: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

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

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>(
        `${environment.apiUrl}/auth/login`,
        {
          email,
          password,
        },
        { withCredentials: true },
      ),
    );
    this.setSession(response);
  }

  async logout(): Promise<void> {
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
      this.router.navigate(["/login"]);
      return false;
    }
  }

  // Called on app startup to restore session if a refresh token cookie exists.
  // Returns true if session was restored, false if the user needs to log in.
  async tryRestoreSession(): Promise<boolean> {
    return this.refresh();
  }

  getAccessToken(): string | null {
    return this._accessToken();
  }

  private setSession(response: AuthResponse): void {
    this._accessToken.set(response.accessToken);
    this._currentUser.set(response.user);
  }

  private clearSession(): void {
    this._accessToken.set(null);
    this._currentUser.set(null);
  }
}
