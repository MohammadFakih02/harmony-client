import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Friend, PendingFriend } from '../models/friend.models';

@Injectable({ providedIn: 'root' })
export class FriendService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getFriends(): Promise<Friend[]> {
    return firstValueFrom(this.http.get<Friend[]>(`${this.base}/friends`));
  }

  getPending(): Promise<PendingFriend[]> {
    return firstValueFrom(this.http.get<PendingFriend[]>(`${this.base}/friends/pending`));
  }

  /** Sends a request by username. Returns 200 (may auto-accept a reciprocal request). */
  sendRequest(username: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/friends/request`, { username }));
  }

  accept(requesterId: string): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${this.base}/friends/${requesterId}/accept`, {}));
  }

  /** Decline / cancel / unfriend — the unified delete. */
  remove(userId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/friends/${userId}`));
  }
}
