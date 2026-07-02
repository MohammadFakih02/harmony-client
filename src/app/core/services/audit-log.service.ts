import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuditLogEntry, AuditLogQuery } from '../models/audit-log.models';

/**
 * Wire shape of an audit entry — the API serializes `long` (id/actorId/targetId/createdAt) as
 * strings via the LongStringConverter. Ids stay strings; `createdAt` is coerced to a number.
 */
interface RawAuditEntry extends Omit<AuditLogEntry, 'createdAt'> {
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Read a guild's moderation history (ViewAuditLog). Newest first; `before` pages older. */
  async getAuditLog(guildId: string, query: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
    let params = new HttpParams();
    if (query.before) params = params.set('before', query.before);
    if (query.action) params = params.set('action', query.action);

    const raw = await firstValueFrom(
      this.http.get<RawAuditEntry[]>(`${this.base}/guilds/${guildId}/audit-log`, { params }),
    );
    return raw.map((r) => ({ ...r, createdAt: Number(r.createdAt) }));
  }
}
