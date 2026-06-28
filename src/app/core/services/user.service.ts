import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationActor } from '../models/notification.models';
import { MyEditableProfile, PublicUserProfile } from '../models/user.models';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getById(id: string): Promise<NotificationActor> {
    return firstValueFrom(this.http.get<NotificationActor>(`${this.base}/users/${id}`));
  }

  /** Another user's public profile (avatar/banner/bio/status/age). */
  getProfile(id: string): Promise<PublicUserProfile> {
    return firstValueFrom(this.http.get<PublicUserProfile>(`${this.base}/users/${id}`));
  }

  /** The current user's editable profile (includes the raw DOB; /me has more fields we ignore). */
  getMe(): Promise<MyEditableProfile> {
    return firstValueFrom(this.http.get<MyEditableProfile>(`${this.base}/users/me`));
  }

  /** Updates the current user's profile. Omitted fields are left unchanged; "" clears the DOB. */
  updateProfile(patch: { bio?: string; dateOfBirth?: string }): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${this.base}/users/me`, patch));
  }
}
