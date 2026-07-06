import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'harmony-nsfw-consent';

/**
 * Remembers which age-restricted (NSFW) channels the user has confirmed they're old enough to view,
 * persisted in localStorage so the gate isn't shown again on every visit (Discord's behaviour). A
 * signal backs it so the gate reacts to `acknowledge()` immediately.
 */
@Injectable({ providedIn: 'root' })
export class NsfwConsentService {
  private readonly acknowledged = signal<ReadonlySet<string>>(this.load());

  has(channelId: string): boolean {
    return this.acknowledged().has(channelId);
  }

  acknowledge(channelId: string): void {
    const next = new Set(this.acknowledged());
    next.add(channelId);
    this.acknowledged.set(next);
    this.persist(next);
  }

  private load(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  private persist(ids: ReadonlySet<string>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
    } catch {
      // fail-soft — consent just won't persist across reloads
    }
  }
}
