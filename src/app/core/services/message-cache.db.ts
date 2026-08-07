import { Injectable, OnDestroy } from '@angular/core';
import * as Comlink from 'comlink';
import { MessageResponse } from '../models/message.models';
import { MessageCacheCore, idbAvailable } from './message-cache.core';

/**
 * Local-first message cache facade (Track A1 + A3). Public API is unchanged from the original
 * main-thread version — MessageStore still calls `enabled` / `loadChannel` / `putMessages` exactly as
 * before — but the actual IndexedDB/Dexie work now runs in a **Web Worker** (message-cache.worker.ts) so
 * it can never surface as a main-thread long task while you type or scroll. The in-memory signal layer in
 * MessageStore stays the source of truth; this is persistence ONLY, and deliberately best-effort.
 *
 * Backend is chosen once at construction:
 *   • Workers available (real browser/prod) → a Comlink proxy over the worker.
 *   • else IndexedDB available (jsdom + fake-indexeddb in specs; worker-less browsers) → an in-process
 *     MessageCacheCore on the main thread (graceful fallback, keeps the store-integration specs real).
 *   • else → no-op (the many specs that build the root store without IndexedDB — unchanged behaviour).
 * `enabled` stays a synchronous boolean so MessageStore's hot-path persist gate is unchanged.
 */

/** The subset both backends satisfy — the in-process core and the Comlink worker proxy alike. */
interface CacheOps {
  loadChannel(channelId: string, limit?: number): Promise<MessageResponse[]>;
  putMessages(channelId: string, messages: readonly MessageResponse[]): Promise<void>;
  clearAll(): Promise<void>;
  clearChannel(channelId: string): Promise<void>;
}

/** Resolves to `fallback` if `p` hasn't settled within `ms` (a hung worker never rejects). */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Newest settled messages for a channel is on the awaited critical path (MessageStore.loadMessages
 * blocks on it before painting). `new Worker(...)` can *construct* successfully yet the module never
 * loads at runtime (a stale/404 lazy chunk after a redeploy, a late CSP block) — a Comlink call to
 * such a worker never resolves AND never rejects, so a bare `await` would hang the channel open
 * forever (stuck spinner). This bounds that read so it degrades to an empty cache instead.
 */
const WORKER_READ_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class MessageCacheDb implements OnDestroy {
  /** Whether the cache is usable in this environment. Callers gate scheduling on this. */
  readonly enabled: boolean;
  private backend: CacheOps | null;
  private readonly worker: Worker | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(new URL('./message-cache.worker', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;
        // A runtime worker failure (module load error, uncaught throw inside) surfaces here, not at
        // construction — drop to the no-op backend so subsequent calls short-circuit fast rather
        // than posting messages into a dead worker that will never reply.
        worker.onerror = () => {
          this.backend = null;
        };
        this.backend = Comlink.wrap<MessageCacheCore>(worker) as unknown as CacheOps;
        this.enabled = true;
        return;
      } catch {
        // Worker unavailable/blocked (CSP, etc.) → fall through to the main-thread fallback.
      }
    }
    if (idbAvailable()) {
      this.backend = new MessageCacheCore();
      this.enabled = true;
    } else {
      this.backend = null;
      this.enabled = false;
    }
  }

  /** Newest settled messages for a channel, ascending. Empty on a miss/unavailable/worker error. */
  async loadChannel(channelId: string, limit?: number): Promise<MessageResponse[]> {
    if (!this.backend) return [];
    try {
      return await withTimeout(this.backend.loadChannel(channelId, limit), WORKER_READ_TIMEOUT_MS, []);
    } catch {
      return [];
    }
  }

  /** Upserts settled messages for a channel (worker-side bulkPut + eviction). Never rejects. */
  async putMessages(channelId: string, messages: readonly MessageResponse[]): Promise<void> {
    if (!this.backend) return;
    try {
      await this.backend.putMessages(channelId, messages);
    } catch {
      /* best-effort — persistence is a nicety, not correctness */
    }
  }

  /** Wipes the entire cache (e.g. on logout). Best-effort. */
  async clearAll(): Promise<void> {
    if (!this.backend) return;
    try {
      await this.backend.clearAll();
    } catch {
      /* ignore */
    }
  }

  /** Drops all cached messages + meta for a channel (e.g. when it's deleted). Best-effort. */
  async clearChannel(channelId: string): Promise<void> {
    if (!this.backend) return;
    try {
      await this.backend.clearChannel(channelId);
    } catch {
      /* ignore */
    }
  }

  ngOnDestroy(): void {
    this.worker?.terminate();
  }
}
