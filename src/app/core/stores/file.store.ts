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
        guildId: string,
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
    };
  }),
);
