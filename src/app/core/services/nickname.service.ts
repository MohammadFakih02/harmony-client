import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Friend (per-user, private) nicknames — a personal alias only the caller sees, used as the
 * friend/DM display name. Independent of guild membership; server (guild) nicknames are separate
 * and live on MemberService.
 */
@Injectable({ providedIn: 'root' })
export class NicknameService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** The caller's whole personal nickname map (targetId → nickname). */
  getMine(): Promise<Record<string, string>> {
    return firstValueFrom(this.http.get<Record<string, string>>(`${this.base}/users/me/nicknames`));
  }

  /** Set (or, when blank, clear) my private alias for a user. */
  set(userId: string, nickname: string): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.base}/users/${userId}/nickname`, { nickname }),
    );
  }

  /** Remove my alias for a user. */
  clear(userId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/users/${userId}/nickname`));
  }
}
