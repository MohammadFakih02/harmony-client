import { Component, computed, effect, inject, input } from '@angular/core';
import { FileStore } from '../../../core/stores/file.store';
import { LightboxService } from '../../../shared/ui/lightbox/lightbox.service';
import { FileDownloadResponse } from '../../../core/models/file.models';

const MAX_W = 400;
const MAX_H = 300;

interface RenderedAttachment {
  id: string;
  meta: FileDownloadResponse | undefined;
  failed: boolean;
  // Reserved display box — sized from metadata so layout is stable before the bytes load.
  width: number;
  height: number;
}

/** Renders a message's image attachments inline. Resolves each id → short-lived
 *  presigned URL via FileStore; reserves space from the stored dimensions so the
 *  fixed-size virtual scroll never sees a reflow jump. Click → lightbox. */
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

  protected readonly rendered = computed<RenderedAttachment[]>(() => {
    const cache = this.fileStore.cache();
    return this.attachmentIds().map((id) => {
      const meta = cache[id];
      const { width, height } = this.box(meta);
      return { id, meta, failed: this.failed.has(id), width, height };
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
    this.lightbox.open(meta.url, meta.filename);
  }
}
