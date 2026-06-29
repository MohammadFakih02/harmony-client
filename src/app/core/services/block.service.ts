import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BlockedUser } from '../models/block.models';

@Injectable({ providedIn: 'root' })
export class BlockService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  list(): Promise<BlockedUser[]> {
    return firstValueFrom(this.http.get<BlockedUser[]>(`${this.base}/users/me/blocks`));
  }

  unblock(userId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/users/${userId}/block`));
  }
}
