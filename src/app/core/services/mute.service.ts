import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Mute, MuteTargetType } from '../models/mute.models';

@Injectable({ providedIn: 'root' })
export class MuteService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** The caller's currently-active mutes (expired-but-unswept ones are filtered out server-side). */
  list(): Promise<Mute[]> {
    return firstValueFrom(this.http.get<Mute[]>(`${this.base}/mutes`));
  }

  remove(targetType: MuteTargetType, targetId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/mutes/${targetType}/${targetId}`),
    );
  }
}
