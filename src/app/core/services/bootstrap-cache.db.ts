import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { idbAvailable } from './message-cache.core';
import type { BootstrapResponse } from './bootstrap.service';

/** Single-row snapshot of the whole boot payload, stamped with the user it belongs to. */
interface BootstrapSnapshot {
  key: string; // constant PK — there is only ever one row
  userId: string;
  payload: BootstrapResponse;
}

const SNAPSHOT_KEY = 'current';

class HarmonyBootstrapCacheDb extends Dexie {
  snapshot!: Table<BootstrapSnapshot, string>;

  constructor() {
    super('harmony-bootstrap-cache');
    this.version(1).stores({ snapshot: 'key' });
  }
}

/**
 * Local-first SHELL cache (Track A1 slice 2). Persists the aggregated `GET /users/me/bootstrap` payload
 * so a hard reload can paint the whole shell — guild rail, DM/friends lists, unread badges, nicknames,
 * notifications, own status — from IndexedDB instantly, then reconcile with the server. Persistence ONLY:
 * the in-memory signal stores stay the source of truth; this is only read to paint-then-reconcile, never
 * trusted as truth.
 *
 * Best-effort by design: every method no-ops when IndexedDB is unavailable (jsdom/vitest, private mode,
 * quota), so it can never break the app or the specs.
 *
 * ONE row, keyed by a constant and stamped with the owning `userId`: a successful boot overwrites it, and
 * `read()` only returns the payload when the stored userId matches the caller — so a snapshot left by a
 * previously-logged-in account on the same browser is never painted into another user's session. Runs on
 * the MAIN THREAD by design (unlike the per-message cache): it's a single small blob read once at boot and
 * written once per boot, so there's no write-thrashing for a worker to offload.
 */
@Injectable({ providedIn: 'root' })
export class BootstrapCacheDb {
  /** Whether the cache is usable in this environment. */
  readonly enabled = idbAvailable();
  private db: HarmonyBootstrapCacheDb | null = null;

  private getDb(): HarmonyBootstrapCacheDb | null {
    if (!this.enabled) return null;
    try {
      this.db ??= new HarmonyBootstrapCacheDb();
      return this.db;
    } catch {
      return null;
    }
  }

  /** The cached boot payload for `userId`, or null on miss / different user / unavailable. */
  async read(userId: string): Promise<BootstrapResponse | null> {
    const db = this.getDb();
    if (!db) return null;
    try {
      const row = await db.snapshot.get(SNAPSHOT_KEY);
      return row && row.userId === userId ? row.payload : null;
    } catch {
      return null;
    }
  }

  /** Overwrites the single snapshot with the latest payload, stamped for `userId`. Never rejects. */
  async write(userId: string, payload: BootstrapResponse): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.snapshot.put({ key: SNAPSHOT_KEY, userId, payload });
    } catch {
      /* best-effort — persistence is a nicety, not correctness */
    }
  }

  /** Drops the snapshot (e.g. on logout). Best-effort. */
  async clear(): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.snapshot.clear();
    } catch {
      /* ignore */
    }
  }
}
