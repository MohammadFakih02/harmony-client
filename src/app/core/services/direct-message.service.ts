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

  /** Creates a group DM with two or more other users (name optional). */
  createGroup(name: string | null, userIds: string[]): Promise<DirectMessageChannel> {
    return firstValueFrom(
      this.http.post<DirectMessageChannel>(`${this.base}/dm/group`, { name, userIds }),
    );
  }

  /** Adds a user to an existing group DM. */
  addParticipant(channelId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`${this.base}/dm/${channelId}/participants`, { userId }),
    );
  }

  /** Leaves a group DM. */
  leave(channelId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/dm/${channelId}/participants/me`));
  }

  /**
   * Whether the caller may send in this DM right now (block / the peer's DM-privacy checklist), with
   * a reason to show when they can't. Lets the composer disable the input up front instead of failing
   * a doomed send. 1:1 only in practice — groups always return canSend.
   */
  sendGate(channelId: string): Promise<{ canSend: boolean; reason: string | null }> {
    return firstValueFrom(
      this.http.get<{ canSend: boolean; reason: string | null }>(
        `${this.base}/dm/${channelId}/send-gate`,
      ),
    );
  }

  /** Renames a group DM (any participant); empty name clears back to the joined member names. */
  rename(channelId: string, name: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/dm/${channelId}/name`, { name }));
  }

  // ---- group icon — participant-scoped presign → PUT → confirm (mirrors profile assets) ----

  presignIcon(
    channelId: string,
    req: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }> {
    return firstValueFrom(
      this.http.post<{ fileId: string; uploadUrl: string; objectKey: string; expiresAt: string }>(
        `${this.base}/dm/${channelId}/icon/presign`,
        req,
      ),
    );
  }

  /** Finalizes the upload — the returned key is now set on the group channel. */
  confirmIcon(channelId: string, fileId: string): Promise<{ key: string }> {
    return firstValueFrom(
      this.http.post<{ key: string }>(`${this.base}/dm/${channelId}/icon/${fileId}/confirm`, null),
    );
  }

  /** Clears the group icon (idempotent). */
  removeIcon(channelId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/dm/${channelId}/icon`));
  }

  getMyDms(): Promise<DirectMessageChannel[]> {
    return firstValueFrom(this.http.get<DirectMessageChannel[]>(`${this.base}/dm`));
  }

  hide(channelId: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.base}/dm/${channelId}/hide`, {}));
  }
}
