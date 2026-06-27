import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppNotification } from '../models/notification.models';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getNotifications(limit = 20): Promise<AppNotification[]> {
    return firstValueFrom(
      this.http.get<AppNotification[]>(`${this.base}/notifications`, {
        params: { limit: String(limit) },
      }),
    );
  }

  /**
   * The endpoint returns a bare JSON int (e.g. `5`), not an object. The app's global
   * bigIntInterceptor only JSON.parses object/array bodies — a bare scalar comes back
   * as a raw string, so this must coerce explicitly.
   */
  async getUnreadCount(): Promise<number> {
    const raw = await firstValueFrom(
      this.http.get<unknown>(`${this.base}/notifications/unread-count`),
    );
    return Number(raw);
  }

  markRead(id: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/notifications/${id}/read`, {}));
  }

  markAllRead(): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.base}/notifications/read-all`, {}));
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/notifications/${id}`));
  }

  clearAll(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/notifications`));
  }
}
