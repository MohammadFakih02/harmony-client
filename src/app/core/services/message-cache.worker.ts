/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { MessageCacheCore } from './message-cache.core';

/**
 * Web Worker host for the message cache (Track A3). Keeps all IndexedDB/Dexie work — bulkPut, eviction
 * sorts, per-channel scans — off the main thread so it can never show up as a main-thread long task while
 * you type or scroll. The main thread talks to this via a Comlink proxy (see MessageCacheDb); the
 * interface is identical to MessageCacheCore.
 *
 * This worker is intentionally structured to host more tenants later (markdown parse, search, syntax
 * highlight, image decode — the rest of A3); for now it owns the cache only.
 */
Comlink.expose(new MessageCacheCore());
