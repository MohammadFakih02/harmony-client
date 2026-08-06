import { Component, HostListener, inject, signal } from '@angular/core';
import { LightboxService } from './lightbox.service';

/** Full-screen image overlay. Mount once (in the shell); driven by LightboxService. */
@Component({
  selector: 'ui-lightbox',
  standalone: true,
  templateUrl: './lightbox.html',
})
export class Lightbox {
  protected readonly lightbox = inject(LightboxService);
  protected readonly downloading = signal(false);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.lightbox.close();
  }

  /**
   * Save the image. Presigned S3/MinIO URLs are cross-origin, so a plain `<a download>` is ignored
   * (the browser navigates instead of saving) — fetch the bytes and download the blob to force a save
   * with the real filename. Falls back to opening the URL in a new tab if the fetch is blocked.
   */
  protected async download(): Promise<void> {
    const img = this.lightbox.current();
    if (!img || this.downloading()) return;
    this.downloading.set(true);
    try {
      const res = await fetch(img.url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = img.filename || img.alt || 'image';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(img.url, '_blank', 'noopener');
    } finally {
      this.downloading.set(false);
    }
  }
}
