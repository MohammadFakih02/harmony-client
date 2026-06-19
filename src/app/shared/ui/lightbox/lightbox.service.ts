import { Injectable, signal } from '@angular/core';

export interface LightboxImage {
  url: string;
  alt: string;
}

/** App-wide single-image lightbox. The host component (mounted once in the shell)
 *  renders whatever this holds; any component can `open()` it. */
@Injectable({ providedIn: 'root' })
export class LightboxService {
  private readonly _current = signal<LightboxImage | null>(null);
  readonly current = this._current.asReadonly();

  open(url: string, alt = ''): void {
    this._current.set({ url, alt });
  }

  close(): void {
    this._current.set(null);
  }
}
