import { Injectable } from '@angular/core';

/**
 * Per-channel composer drafts. Kept in memory for the session and mirrored to localStorage so an
 * unsent message survives a channel switch AND a full reload (Discord behaviour). Keyed by channel
 * id; empty/whitespace drafts are cleared rather than stored so a blank composer never lingers.
 */
@Injectable({ providedIn: 'root' })
export class DraftService {
  private static readonly PREFIX = 'harmony.draft.';
  private readonly cache = new Map<string, string>();

  /** The saved draft for a channel ('' when none). Reads through to localStorage on a cache miss. */
  get(channelId: string): string {
    const cached = this.cache.get(channelId);
    if (cached !== undefined) return cached;
    let stored = '';
    try {
      stored = localStorage.getItem(DraftService.PREFIX + channelId) ?? '';
    } catch {
      /* storage unavailable (private mode / disabled) — treat as empty */
    }
    this.cache.set(channelId, stored);
    return stored;
  }

  /** Saves (or, when blank, clears) a channel's draft. Best-effort — the in-memory copy always holds. */
  set(channelId: string, text: string): void {
    this.cache.set(channelId, text);
    try {
      if (text.trim()) localStorage.setItem(DraftService.PREFIX + channelId, text);
      else localStorage.removeItem(DraftService.PREFIX + channelId);
    } catch {
      /* quota / disabled — the session cache still reflects the latest draft */
    }
  }

  /** Drops a channel's draft entirely (called once its message has been sent). */
  clear(channelId: string): void {
    this.cache.delete(channelId);
    try {
      localStorage.removeItem(DraftService.PREFIX + channelId);
    } catch {
      /* ignore */
    }
  }
}
