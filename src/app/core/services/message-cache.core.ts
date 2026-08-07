import Dexie, { Table } from 'dexie';
import { MessageResponse } from '../models/message.models';
import { compareSnowflakes } from '../../shared/util/snowflake';

/**
 * Pure IndexedDB message-cache logic (Track A1 / A3). No Angular, no worker — this is the storage engine
 * that runs INSIDE the Web Worker (see message-cache.worker.ts) and also serves as the main-thread
 * fallback for environments without workers (see MessageCacheDb). Deliberately best-effort: every method
 * degrades to a no-op when IndexedDB is unavailable, so it can never break the app or the specs.
 *
 * The in-memory signal layer in MessageStore stays the source of truth — this is persistence ONLY.
 */

/** Fields that only live on an in-flight/optimistic bubble — never persisted. */
export type PersistedMessage = Omit<
  MessageResponse,
  'pending' | 'failed' | 'failedReason' | 'tempId' | 'nonce'
>;

interface ChannelMeta {
  channelId: string;
  lastViewedAt: number;
}

/** Per-channel retention cap: history beyond this is evicted (re-fetchable on scroll-up). */
const PER_CHANNEL_KEEP = 500;

/** Newest-N painted on hydrate — a screen-plus, aligned with MessageStore's in-memory window. */
const DEFAULT_HYDRATE_LIMIT = 200;

/**
 * Proactive quota management (Track A1 tail). The per-channel cap bounds each channel, but a very
 * active user across many channels can still approach the origin's storage quota; on quota exhaustion
 * IndexedDB starts rejecting writes. Rather than only reacting to a QuotaExceededError, we check
 * `navigator.storage.estimate()` (throttled — it hits disk) and, when usage crosses the high-water
 * mark, drop whole channels least-recently-viewed first until back under the target. The active
 * channel was just written (newest lastViewedAt) so it is never the one evicted.
 */
const QUOTA_CHECK_INTERVAL_MS = 60_000;
const QUOTA_HIGH_WATER = 0.85;
const QUOTA_TARGET = 0.6;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function sanitize(m: MessageResponse): PersistedMessage {
  // Strip the client-only bubble fields; keep the server-authoritative shape.
  const { pending, failed, failedReason, tempId, nonce, ...rest } = m;
  return rest;
}

class HarmonyCacheDb extends Dexie {
  messages!: Table<PersistedMessage, [string, string]>;
  meta!: Table<ChannelMeta, string>;

  constructor() {
    super('harmony-cache');
    this.version(1).stores({
      // Compound PK [channelId+messageId] upserts by identity; the channelId index drives
      // per-channel load + eviction. messageId snowflakes are re-sorted in JS (BigInt) so we never
      // depend on IndexedDB's lexicographic key order for chronological correctness.
      messages: '[channelId+messageId], channelId',
      meta: 'channelId',
    });
  }
}

/**
 * The storage engine. One instance per context (one in the worker; or one on the main thread when it's
 * the fallback). Comlink exposes this class's async methods across the worker boundary unchanged — the
 * signatures are already Promise-shaped, so the worker relocation is a transport swap, not a logic change.
 */
export class MessageCacheCore {
  /** Whether IndexedDB is usable in THIS context (worker or main thread). */
  readonly enabled = idbAvailable();
  private db: HarmonyCacheDb | null = null;
  /** Last wall-clock time the storage estimate was polled (throttles the proactive sweep). */
  private lastQuotaCheckAt = 0;

  private get instance(): HarmonyCacheDb | null {
    if (!this.enabled) return null;
    if (!this.db) {
      try {
        this.db = new HarmonyCacheDb();
      } catch {
        return null;
      }
    }
    return this.db;
  }

  /**
   * The newest `limit` settled messages for a channel, ascending (oldest→newest, the order
   * MessageStore renders). Empty on a miss or when the cache is unavailable.
   */
  async loadChannel(channelId: string, limit = DEFAULT_HYDRATE_LIMIT): Promise<MessageResponse[]> {
    const db = this.instance;
    if (!db) return [];
    try {
      const rows = await db.messages.where('channelId').equals(channelId).toArray();
      rows.sort((a, b) => compareSnowflakes(a.messageId, b.messageId));
      const tail = rows.length > limit ? rows.slice(rows.length - limit) : rows;
      return tail as MessageResponse[];
    } catch {
      return [];
    }
  }

  /**
   * Upserts settled messages for a channel, then evicts down to the per-channel cap and stamps the
   * channel's last-viewed time. Optimistic/failed bubbles are filtered out. Never rejects.
   */
  async putMessages(channelId: string, messages: readonly MessageResponse[]): Promise<void> {
    const db = this.instance;
    if (!db) return;
    const rows = messages
      .filter((m) => !m.pending && !m.failed && m.tempId === undefined)
      .map(sanitize);
    if (!rows.length) return;
    try {
      await db.messages.bulkPut(rows);
      await this.evict(db, channelId);
      await db.meta.put({ channelId, lastViewedAt: Date.now() });
      // Proactive, throttled (self-skips within the interval), best-effort. Awaited rather than
      // fired-and-forgotten because callers already treat putMessages as fire-and-forget (the store
      // does `void cache.putMessages(...)`), so nothing user-facing waits on it — and awaiting keeps
      // the sweep deterministic and its errors contained in this method's own try/catch.
      await this.maybeEnforceQuota(db);
    } catch (err) {
      // Quota or transient IndexedDB error → best-effort reclaim, never surfaced to the UI.
      if ((err as { name?: string })?.name === 'QuotaExceededError') {
        try {
          await this.evict(db, channelId);
        } catch {
          /* give up silently — persistence is a nicety, not correctness */
        }
      }
    }
  }

  /** Wipes the entire cache (e.g. on logout, or to reclaim space). Best-effort. */
  async clearAll(): Promise<void> {
    const db = this.instance;
    if (!db) return;
    try {
      await Promise.all([db.messages.clear(), db.meta.clear()]);
    } catch {
      /* ignore */
    }
  }

  /** Drops all cached messages + meta for a channel (e.g. when it's deleted). Best-effort. */
  async clearChannel(channelId: string): Promise<void> {
    const db = this.instance;
    if (!db) return;
    try {
      await db.messages.where('channelId').equals(channelId).delete();
      await db.meta.delete(channelId);
    } catch {
      /* ignore */
    }
  }

  private async evict(db: HarmonyCacheDb, channelId: string): Promise<void> {
    const count = await db.messages.where('channelId').equals(channelId).count();
    if (count <= PER_CHANNEL_KEEP) return;
    const keys = (await db.messages
      .where('channelId')
      .equals(channelId)
      .primaryKeys()) as [string, string][];
    keys.sort((a, b) => compareSnowflakes(a[1], b[1]));
    const overflow = keys.slice(0, count - PER_CHANNEL_KEEP);
    await db.messages.bulkDelete(overflow);
  }

  /**
   * Throttled proactive quota sweep. Polls the storage estimate at most once per interval; when usage
   * crosses the high-water mark, drops whole channels least-recently-viewed first (via the meta
   * lastViewedAt stamp) until back under the target — never touching the most-recently-viewed channel
   * (the one just written). Entirely best-effort: any failure is swallowed, persistence is a nicety.
   */
  private async maybeEnforceQuota(db: HarmonyCacheDb): Promise<void> {
    const now = Date.now();
    if (now - this.lastQuotaCheckAt < QUOTA_CHECK_INTERVAL_MS) return;
    this.lastQuotaCheckAt = now;
    try {
      if ((await this.usageRatio()) < QUOTA_HIGH_WATER) return;
      // Oldest-viewed first; the last entry (newest, incl. the active channel) is never evicted.
      const metas = (await db.meta.toArray()).sort((a, b) => a.lastViewedAt - b.lastViewedAt);
      for (let i = 0; i < metas.length - 1; i++) {
        await db.messages.where('channelId').equals(metas[i].channelId).delete();
        await db.meta.delete(metas[i].channelId);
        if ((await this.usageRatio()) < QUOTA_TARGET) break;
      }
    } catch {
      /* best-effort — the reactive QuotaExceededError path in putMessages remains the backstop */
    }
  }

  /** Fraction of the origin's storage quota in use (0–1), or 0 when the estimate is unavailable. */
  private async usageRatio(): Promise<number> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return 0;
      const { usage, quota } = await navigator.storage.estimate();
      return quota ? (usage ?? 0) / quota : 0;
    } catch {
      return 0;
    }
  }
}
