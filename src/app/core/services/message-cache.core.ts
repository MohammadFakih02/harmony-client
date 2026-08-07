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
}
