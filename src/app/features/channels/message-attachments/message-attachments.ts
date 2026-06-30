import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FileStore } from '../../../core/stores/file.store';
import { LightboxService } from '../../../shared/ui/lightbox/lightbox.service';
import { FileDownloadResponse } from '../../../core/models/file.models';
import { FileKind, fileIcon, fileKind, formatBytes } from '../../../shared/util/file-kind';

const MAX_W = 400;
const MAX_H = 300;

interface RenderedAttachment {
  id: string;
  meta: FileDownloadResponse | undefined;
  failed: boolean;
  kind: FileKind;
  icon: string; // FA class for the file card
  sizeLabel: string; // human-readable size for the file card
  // Reserved display box — sized from metadata so layout is stable before the bytes load.
  width: number;
  height: number;
}

/** Renders a message's attachments inline. Resolves each id → short-lived presigned URL via
 *  FileStore; images reserve space from the stored dimensions so the fixed-size virtual scroll
 *  never reflows. Images → inline (lightbox on click), video/audio → inline players, everything
 *  else → a download card. */
@Component({
  selector: 'app-message-attachments',
  standalone: true,
  templateUrl: './message-attachments.html',
})
export class MessageAttachments {
  readonly attachmentIds = input.required<string[]>();
  readonly guildId = input.required<string | null>(); // null for DM attachments
  readonly channelId = input.required<string>();

  private readonly fileStore = inject(FileStore);
  private readonly lightbox = inject(LightboxService);

  // Ids whose resolve failed — rendered as an "unavailable" chip, never retried in a loop.
  private readonly failed = new Set<string>();

  constructor() {
    // Kick off resolution whenever the id list changes.
    effect(() => {
      const ids = this.attachmentIds();
      const guildId = this.guildId();
      const channelId = this.channelId();
      for (const id of ids) {
        if (this.fileStore.cache()[id] || this.failed.has(id)) continue;
        this.fileStore.resolve(guildId, channelId, id).then((meta) => {
          if (!meta) this.failed.add(id);
        });
      }
    });
  }

  // Ids currently being saved via the file-card Download button (cross-origin blob fetch).
  private readonly downloading = signal<ReadonlySet<string>>(new Set());

  protected readonly rendered = computed<RenderedAttachment[]>(() => {
    const cache = this.fileStore.cache();
    return this.attachmentIds().map((id) => {
      const meta = cache[id];
      const { width, height } = this.box(meta);
      return {
        id,
        meta,
        failed: this.failed.has(id),
        kind: fileKind(meta?.contentType),
        icon: fileIcon(meta?.contentType),
        sizeLabel: meta ? formatBytes(meta.sizeBytes) : '',
        width,
        height,
      };
    });
  });

  // Cap to the display bounds while preserving aspect ratio. Unknown dims → a neutral
  // placeholder box (rare; only non-image or pre-resolve).
  private box(meta: FileDownloadResponse | undefined): { width: number; height: number } {
    if (!meta?.width || !meta?.height) return { width: 280, height: 200 };
    const scale = Math.min(MAX_W / meta.width, MAX_H / meta.height, 1);
    return {
      width: Math.round(meta.width * scale),
      height: Math.round(meta.height * scale),
    };
  }

  protected open(meta: FileDownloadResponse): void {
    this.lightbox.open(meta.url, meta.filename, meta.filename);
  }

  protected isDownloading(id: string): boolean {
    return this.downloading().has(id);
  }

  /**
   * Save a file-card attachment. Presigned S3/MinIO URLs are cross-origin, so a plain
   * `<a download>` is ignored — fetch the bytes and download the blob to force a save with the
   * real filename. Falls back to opening the URL in a new tab if the fetch is blocked. (Same
   * approach the lightbox uses for images.)
   */
  protected async download(meta: FileDownloadResponse): Promise<void> {
    if (this.downloading().has(meta.id.toString())) return;
    const id = meta.id.toString();
    this.downloading.update((s) => new Set(s).add(id));
    try {
      const res = await fetch(meta.url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = meta.filename || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(meta.url, '_blank', 'noopener');
    } finally {
      this.downloading.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }
}
