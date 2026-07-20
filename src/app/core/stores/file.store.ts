import { computed, inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { FileDownloadResponse } from '../models/file.models';
import { FileService } from '../services/file.service';

// Re-mint the presigned URL once it's within this window of expiry (the URL is the
// only part that expires — static metadata is reused).
const REFRESH_MARGIN_MS = 30_000;

interface FileState {
  // fileId → resolved download metadata (with a short-lived presigned URL)
  cache: Record<string, FileDownloadResponse>;
}

export const FileStore = signalStore(
  { providedIn: 'root' },
  withState<FileState>({ cache: {} }),
  withMethods((store, service = inject(FileService)) => {
    // Dedupe concurrent resolves for the same id (non-reactive — purely a guard).
    const inFlight = new Map<string, Promise<FileDownloadResponse | null>>();

    const isFresh = (meta: FileDownloadResponse): boolean =>
      meta.expiresAt - Date.now() > REFRESH_MARGIN_MS;

    return {
      /** Reactive read — the renderer binds to this; undefined until resolved. */
      get: (fileId: string) => computed(() => store.cache()[fileId]),

      /**
       * Returns cached metadata if its URL is still fresh, otherwise fetches (and
       * re-mints the URL). Fail-soft: returns null on error so the list never breaks.
       */
      async resolve(
        guildId: string | null,
        channelId: string,
        fileId: string,
      ): Promise<FileDownloadResponse | null> {
        const cached = store.cache()[fileId];
        if (cached && isFresh(cached)) return cached;

        const existing = inFlight.get(fileId);
        if (existing) return existing;

        const promise = service
          .getDownload(guildId, channelId, fileId)
          .then((meta) => {
            patchState(store, { cache: { ...store.cache(), [fileId]: meta } });
            return meta;
          })
          .catch(() => null)
          .finally(() => inFlight.delete(fileId));

        inFlight.set(fileId, promise);
        return promise;
      },

      /**
       * Prewarms the cache for a whole message page's attachments in ONE round trip (the
       * per-attachment resolve() above is the fallback for live messages / anything this
       * missed). Ids already fresh or in flight are skipped; each fetched id also registers
       * an in-flight share so a concurrent resolve() dedupes against the batch. Fail-soft:
       * a failed batch resolves nothing and the per-attachment path takes over.
       */
      async resolveMany(
        guildId: string | null,
        channelId: string,
        fileIds: string[],
      ): Promise<void> {
        const need = [...new Set(fileIds)].filter((id) => {
          const cached = store.cache()[id];
          return !(cached && isFresh(cached)) && !inFlight.has(id);
        });
        if (need.length === 0) return;

        const batch = service
          .getDownloads(guildId, channelId, need)
          .then((metas) => {
            const next = { ...store.cache() };
            for (const meta of metas) next[meta.id] = meta;
            patchState(store, { cache: next });
            return metas;
          })
          .catch(() => null);

        for (const id of need) {
          inFlight.set(
            id,
            batch
              .then((metas) => metas?.find((m) => m.id === id) ?? null)
              .finally(() => inFlight.delete(id)),
          );
        }
        await batch;
      },
    };
  }),
);
