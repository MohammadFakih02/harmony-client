import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationActor } from '../models/notification.models';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getById(id: string): Promise<NotificationActor> {
    return firstValueFrom(this.http.get<NotificationActor>(`${this.base}/users/${id}`));
  }
}
