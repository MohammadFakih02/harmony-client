import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationActor } from '../models/notification.models';
import { DmAudience, MyEditableProfile, PublicUserProfile } from '../models/user.models';

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

  /** Updates the current user's profile. Omitted fields are left unchanged; "" clears DOB/colour. */
  updateProfile(patch: {
    bio?: string;
    dateOfBirth?: string;
    bannerColor?: string;
  }): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${this.base}/users/me`, patch));
  }

  // ---- profile assets (avatar/banner image) — user-scoped presign → PUT → confirm ----

  presignAsset(
    kind: 'avatar' | 'banner',
    req: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }> {
    return firstValueFrom(
      this.http.post<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }>(
        `${this.base}/users/me/${kind}/presign`,
        req,
      ),
    );
  }

  /** Finalizes the upload — the returned key is now set on the profile. */
  confirmAsset(kind: 'avatar' | 'banner', fileId: string): Promise<{ key: string }> {
    return firstValueFrom(
      this.http.post<{ key: string }>(`${this.base}/users/me/${kind}/${fileId}/confirm`, null),
    );
  }

  /** Clears the avatar/banner image from the profile. */
  removeAsset(kind: 'avatar' | 'banner'): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.base}/users/me/${kind}`));
  }

  /** Sets the checklist of who may open a new DM with the current user. */
  updateDmPrivacy(audiences: DmAudience[]): Promise<MyEditableProfile> {
    return firstValueFrom(
      this.http.patch<MyEditableProfile>(`${this.base}/users/me/dm-privacy`, { audiences }),
    );
  }
}
