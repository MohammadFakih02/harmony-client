import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PreferredStatus } from '../models/presence.models';

/**
 * Thin HTTP wrapper for presence reads/writes. Real-time updates arrive over SignalR
 * (handled by PresenceStore); this covers the REST surface: bulk status read, the
 * user's own preferred status, and updating it.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Effective statuses for a set of users → { userId: status }. Absent users come back "offline". */
  getStatuses(userIds: string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) return Promise.resolve({});
    const params = new HttpParams().set('ids', userIds.join(','));
    return firstValueFrom(
      this.http.get<Record<string, string>>(`${this.base}/users/presence`, { params }),
    );
  }

  /** The current user's durable preferred status (from GET /me). */
  async getMyPreferredStatus(): Promise<string> {
    const me = await firstValueFrom(
      this.http.get<{ preferredStatus: string }>(`${this.base}/users/me`),
    );
    return me.preferredStatus;
  }

  /** Sets the current user's preferred status. */
  setMyStatus(status: PreferredStatus): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${this.base}/users/me/status`, { status }));
  }
}
