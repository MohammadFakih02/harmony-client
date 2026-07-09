// Shared classification for message attachments — mirrors the backend allowlist
// (FileService.AllowedContentTypes). Drives both the composer's staged preview and the
// in-chat render (image inline / video+audio players / file download card).

export type FileKind = 'image' | 'video' | 'audio' | 'file';

/** The full set of content types the backend accepts (mirror of FileService.AllowedContentTypes). */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
];

export function isAllowedType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.includes(contentType.toLowerCase());
}

// Some allowed text formats (notably .md) report an empty `File.type` in the browser, so the file
// would be rejected client-side despite being allowed. Fall back to a filename-extension map for the
// signature-less text types the backend accepts.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
};

/** Infers a content type from the filename extension (only when the browser gives none). */
export function contentTypeFromName(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPES[ext] ?? null;
}

/** The File's own MIME type, or an extension-based fallback when the browser reports none. */
export function effectiveContentType(file: File): string {
  return file.type || contentTypeFromName(file.name) || '';
}

/** Bucket a content type into how it should render. Unknown / non-media → 'file'. */
export function fileKind(contentType: string | undefined | null): FileKind {
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'file';
}

/** A Font Awesome icon class for a non-media (file-card) attachment. */
export function fileIcon(contentType: string | undefined | null): string {
  const type = (contentType ?? '').toLowerCase();
  if (type === 'application/pdf') return 'fa-file-pdf';
  if (type === 'application/zip') return 'fa-file-zipper';
  if (type === 'text/csv') return 'fa-file-csv';
  if (type.startsWith('text/')) return 'fa-file-lines';
  if (type.startsWith('audio/')) return 'fa-file-audio';
  if (type.startsWith('video/')) return 'fa-file-video';
  if (type.startsWith('image/')) return 'fa-file-image';
  return 'fa-file';
}

/** Human-readable byte size, e.g. 2.4 MB. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Whole bytes show no decimal; KB+ show one.
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
