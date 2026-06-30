import { Injectable, inject } from '@angular/core';
import { FileService } from './file.service';
import { MessageService } from './message.service';
import { FileStore } from '../stores/file.store';

/** The message being forwarded, identified by its source channel (for attachment re-upload). */
export interface ForwardSource {
  guildId: string | null;
  channelId: string;
  content: string;
  attachmentIds: string[];
}

/** A destination channel or DM (guildId null = DM). */
export interface ForwardTarget {
  guildId: string | null;
  channelId: string;
}

/**
 * Combines an optional forwarder note with the original content. Attachment ids are channel-scoped
 * on the backend, so a forward can't reuse them across channels — pure text combining is the only
 * part that's deterministic, hence the standalone helper (unit-tested directly).
 */
export function buildForwardContent(note: string | undefined, original: string): string {
  const n = note?.trim() ?? '';
  const o = original ?? '';
  if (n && o) return `${n}\n\n${o}`;
  return n || o;
}

/**
 * Forwards a message to an arbitrary channel/DM by *re-sending* through the normal send path
 * (plain re-send — no backend forward-snapshot). Attachment ids can't cross channels (the backend
 * scopes them to uploader + guild + channel), so each image is re-uploaded to the target: its bytes
 * are fetched from the source's presigned URL, then run through the standard presign → PUT → confirm
 * flow against the target channel. This deliberately bypasses MessageStore, which is bound to the
 * *active* channel — a forward targets some other channel and must not touch the open view's state.
 */
@Injectable({ providedIn: 'root' })
export class ForwardService {
  private readonly fileService = inject(FileService);
  private readonly fileStore = inject(FileStore);
  private readonly messageService = inject(MessageService);

  async forward(source: ForwardSource, target: ForwardTarget, note?: string): Promise<void> {
    const attachmentIds = await this.reuploadAttachments(source, target);
    const content = buildForwardContent(note, source.content);
    await this.messageService.sendMessage(target.guildId, target.channelId, content, {
      attachmentIds: attachmentIds.length ? attachmentIds : undefined,
    });
  }

  /** Re-uploads every source attachment to the target channel, returning the fresh ids. */
  private async reuploadAttachments(
    source: ForwardSource,
    target: ForwardTarget,
  ): Promise<string[]> {
    const newIds: string[] = [];
    for (const id of source.attachmentIds) {
      const meta = await this.fileStore.resolve(source.guildId, source.channelId, id);
      if (!meta) continue; // unresolvable (deleted / expired) — skip rather than fail the whole forward

      const blob = await fetch(meta.url).then((r) => r.blob());
      // Content-Type must match what we declare at presign (the signature binds it).
      const file = new File([blob], meta.filename, { type: meta.contentType });
      const presign = await this.fileService.presign(target.guildId, target.channelId, {
        filename: meta.filename,
        contentType: meta.contentType,
        sizeBytes: blob.size,
      });
      await this.fileService.upload(presign.uploadUrl, file);
      const confirmed = await this.fileService.confirm(
        target.guildId,
        target.channelId,
        presign.fileId,
      );
      newIds.push(confirmed.id);
    }
    return newIds;
  }
}
