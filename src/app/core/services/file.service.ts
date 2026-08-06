import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  FileAttachmentResponse,
  FileDownloadResponse,
  PresignFileRequest,
  PresignFileResponse,
} from '../models/file.models';

@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // A guild channel nests its files under the guild; a DM (guildId null) under /dm/{channelId}.
  private files(guildId: string | null, channelId: string): string {
    return guildId == null
      ? `${this.base}/dm/${channelId}/files`
      : `${this.base}/guilds/${guildId}/channels/${channelId}/files`;
  }

  presign(
    guildId: string | null,
    channelId: string,
    req: PresignFileRequest,
  ): Promise<PresignFileResponse> {
    return firstValueFrom(
      this.http.post<PresignFileResponse>(`${this.files(guildId, channelId)}/presign`, req),
    );
  }

  /**
   * PUTs the bytes directly to the object store via the presigned URL. Uses a raw
   * XMLHttpRequest — NOT HttpClient — because the auth interceptor would attach the
   * JWT + credentials, which breaks the presigned signature and trips CORS. The
   * Content-Type MUST match the type declared at presign (the signature binds it). Pass
   * `contentType` when the File's own type is empty/wrong (e.g. .md → text/markdown) so the
   * header matches what was signed.
   */
  upload(
    uploadUrl: string,
    file: File,
    onProgress?: (pct: number) => void,
    contentType?: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', contentType || file.type);

      if (onProgress) {
        // Progress events fire far more often than the bar can meaningfully move; only
        // propagate whole-percent changes so each upload costs at most ~100 signal writes
        // (each write schedules a change-detection pass in this zoneless app).
        let lastPct = -1;
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(pct);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          console.error('[upload] PUT failed', xhr.status, xhr.responseText, uploadUrl);
          reject(new Error(`Upload rejected by storage (HTTP ${xhr.status})`));
        }
      };
      xhr.onerror = () => {
        // status 0 here = the browser blocked/failed the request before a response
        // (CORS, connection refused, blocked port…). The real reason is in the console.
        console.error('[upload] PUT network error (status 0) — see browser console for the block reason. URL:', uploadUrl);
        reject(new Error('Upload blocked by the browser (network/CORS). Check the console.'));
      };
      xhr.send(file);
    });
  }

  confirm(
    guildId: string | null,
    channelId: string,
    fileId: string,
  ): Promise<FileAttachmentResponse> {
    return firstValueFrom(
      this.http.post<FileAttachmentResponse>(
        `${this.files(guildId, channelId)}/${fileId}/confirm`,
        {},
      ),
    );
  }

  getDownload(
    guildId: string | null,
    channelId: string,
    fileId: string,
  ): Promise<FileDownloadResponse> {
    return firstValueFrom(
      this.http.get<FileDownloadResponse>(`${this.files(guildId, channelId)}/${fileId}`),
    );
  }

  /**
   * Batch form of getDownload for prewarming a whole message page in one round trip.
   * Ids that don't resolve (deleted/foreign files) are silently omitted by the server.
   */
  getDownloads(
    guildId: string | null,
    channelId: string,
    fileIds: string[],
  ): Promise<FileDownloadResponse[]> {
    return firstValueFrom(
      this.http.post<FileDownloadResponse[]>(`${this.files(guildId, channelId)}/batch`, {
        fileIds,
      }),
    );
  }
}
