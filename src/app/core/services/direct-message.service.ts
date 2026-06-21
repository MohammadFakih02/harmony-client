import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DirectMessageChannel } from '../models/direct-message.models';

@Injectable({ providedIn: 'root' })
export class DirectMessageService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Opens (or reuses) a 1:1 DM with another user. */
  open(targetUserId: string): Promise<DirectMessageChannel> {
    return firstValueFrom(
      this.http.post<DirectMessageChannel>(`${this.base}/dm`, { targetUserId }),
    );
  }

  getMyDms(): Promise<DirectMessageChannel[]> {
    return firstValueFrom(this.http.get<DirectMessageChannel[]>(`${this.base}/dm`));
  }

  hide(channelId: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/dm/${channelId}/hide`, {}));
  }
}
