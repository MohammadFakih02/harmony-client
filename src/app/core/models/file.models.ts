// Mirrors the backend file DTOs (Harmony.Application/DTOs/{Requests,Responses}).
// All snowflake ids are strings client-side (LongStringConverter on the wire).

export interface PresignFileRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** The presigned PUT to upload to directly, plus the id to confirm against afterwards. */
export interface PresignFileResponse {
  fileId: string;
  uploadUrl: string;
  objectKey: string;
  /** Unix-ms instant the upload URL stops working. */
  expiresAt: number;
}

/** Returned by confirm — the finalized row, with store-authoritative size/type/dims. */
export interface FileAttachmentResponse {
  id: string;
  channelId: string;
  guildId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  isConfirmed: boolean;
  createdAt: number;
}

/** Everything needed to render a confirmed attachment: static metadata + a short-lived URL. */
export interface FileDownloadResponse {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
  /** Unix-ms instant the presigned URL stops working. */
  expiresAt: number;
  /**
   * Presigned URL of the display-only downscaled derivative (large chat images). Null when the
   * original is small enough or animated — inline rendering falls back to `url`. Lightbox / copy /
   * open / download always use `url` (the untouched original).
   */
  thumbnailUrl: string | null;
}
