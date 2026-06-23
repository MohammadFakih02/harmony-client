import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PreferredStatus, UserPresence } from '../models/presence.models';

/**
 * Thin HTTP wrapper for presence reads/writes. Real-time updates arrive over SignalR
 * (handled by PresenceStore); this covers the REST surface: bulk status read, the
 * user's own preferred status, and updating it.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Presence (status + custom message) for a set of users → { userId: UserPresence }. */
  getStatuses(userIds: string[]): Promise<Record<string, UserPresence>> {
    if (userIds.length === 0) return Promise.resolve({});
    const params = new HttpParams().set('ids', userIds.join(','));
    return firstValueFrom(
      this.http.get<Record<string, UserPresence>>(`${this.base}/users/presence`, { params }),
    );
  }

  /** The current user's durable preferred status + custom status message (from GET /me). */
  async getMyProfile(): Promise<{ preferredStatus: string; statusMessage: string | null }> {
    const me = await firstValueFrom(
      this.http.get<{ preferredStatus: string; statusMessage: string | null }>(
        `${this.base}/users/me`,
      ),
    );
    return { preferredStatus: me.preferredStatus, statusMessage: me.statusMessage };
  }

  /** Sets the preferred status; expiresInMinutes auto-reverts it to online (null = never). */
  setMyStatus(status: PreferredStatus, expiresInMinutes: number | null = null): Promise<unknown> {
    return firstValueFrom(
      this.http.patch(`${this.base}/users/me/status`, { status, expiresInMinutes }),
    );
  }

  /** Sets (or clears, with null) the custom status message + its optional clear-after. */
  setCustomStatus(
    message: string | null,
    expiresInMinutes: number | null = null,
  ): Promise<unknown> {
    return firstValueFrom(
      this.http.patch(`${this.base}/users/me/custom-status`, { message, expiresInMinutes }),
    );
  }
}
