import { Injectable, signal } from '@angular/core';

/**
 * App-wide expanded call view (LiveKit Slice 3). Pure view state — the call itself lives in
 * VoiceStore/VoiceService; this only tracks whether the full-screen overlay is showing and which
 * tile (if any) is focused. The host component (mounted once in the shell) renders it; the voice
 * stage's expand button (or any surface) can `open()` it.
 */
@Injectable({ providedIn: 'root' })
export class CallOverlayService {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  /** CallTile id (`userId` / `userId:screen`) shown big; null = plain grid. */
  private readonly _focusedTileId = signal<string | null>(null);
  readonly focusedTileId = this._focusedTileId.asReadonly();

  open(focusTileId?: string): void {
    this._isOpen.set(true);
    if (focusTileId) this._focusedTileId.set(focusTileId);
  }

  close(): void {
    this._isOpen.set(false);
    this._focusedTileId.set(null);
  }

  /** Focus a tile, or unfocus if it's already the focused one. */
  toggleFocus(tileId: string): void {
    this._focusedTileId.update((cur) => (cur === tileId ? null : tileId));
  }

  clearFocus(): void {
    this._focusedTileId.set(null);
  }
}
