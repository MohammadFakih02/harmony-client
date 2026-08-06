import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationPreferences } from '../models/notification-preference.models';

@Injectable({ providedIn: 'root' })
export class NotificationPreferenceService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  get(): Promise<NotificationPreferences> {
    return firstValueFrom(
      this.http.get<NotificationPreferences>(`${this.base}/notifications/preferences`),
    );
  }

  /** Partial update — only the supplied flags change server-side. Returns the full updated set. */
  update(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    return firstValueFrom(
      this.http.patch<NotificationPreferences>(`${this.base}/notifications/preferences`, patch),
    );
  }
}
