import { TestBed } from '@angular/core/testing';
import { FileStore } from './file.store';
import { FileService } from '../services/file.service';
import { FileDownloadResponse } from '../models/file.models';

const makeMeta = (id: string, overrides: Partial<FileDownloadResponse> = {}): FileDownloadResponse => ({
  id,
  filename: `${id}.png`,
  contentType: 'image/png',
  sizeBytes: 1234,
  width: 800,
  height: 600,
  url: `https://minio/${id}`,
  expiresAt: Date.now() + 900_000, // fresh — well past the 30s refresh margin
  thumbnailUrl: null,
  ...overrides,
});

describe('FileStore', () => {
  let store: InstanceType<typeof FileStore>;
  let service: {
    getDownload: ReturnType<typeof vi.fn>;
    getDownloads: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = { getDownload: vi.fn(), getDownloads: vi.fn() };
    TestBed.configureTestingModule({
      providers: [FileStore, { provide: FileService, useValue: service }],
    });
    store = TestBed.inject(FileStore);
  });

  describe('resolveMany()', () => {
    it('issues ONE batch call and primes the cache for every returned id', async () => {
      service.getDownloads.mockResolvedValue([makeMeta('1'), makeMeta('2')]);

      await store.resolveMany('g', 'c', ['1', '2']);

      expect(service.getDownloads).toHaveBeenCalledTimes(1);
      expect(service.getDownloads).toHaveBeenCalledWith('g', 'c', ['1', '2']);
      expect(store.get('1')()).toBeDefined();
      expect(store.get('2')()?.url).toBe('https://minio/2');
    });

    it('deduplicates repeated ids and skips ids already fresh in the cache', async () => {
      service.getDownloads.mockResolvedValue([makeMeta('1')]);
      await store.resolveMany('g', 'c', ['1']);

      service.getDownloads.mockClear();
      service.getDownloads.mockResolvedValue([makeMeta('2')]);
      await store.resolveMany('g', 'c', ['1', '2', '2']);

      expect(service.getDownloads).toHaveBeenCalledWith('g', 'c', ['2']);
    });

    it('makes no call at all when everything is already cached', async () => {
      service.getDownloads.mockResolvedValue([makeMeta('1')]);
      await store.resolveMany('g', 'c', ['1']);

      service.getDownloads.mockClear();
      await store.resolveMany('g', 'c', ['1']);

      expect(service.getDownloads).not.toHaveBeenCalled();
    });

    it('dedupes a concurrent per-attachment resolve() against the in-flight batch', async () => {
      const meta = makeMeta('1');
      let resolveBatch!: (v: FileDownloadResponse[]) => void;
      service.getDownloads.mockReturnValue(new Promise((res) => (resolveBatch = res)));

      const batch = store.resolveMany('g', 'c', ['1']);
      const single = store.resolve('g', 'c', '1'); // must ride the batch, not fetch

      resolveBatch([meta]);
      await batch;

      expect(await single).toEqual(meta);
      expect(service.getDownload).not.toHaveBeenCalled();
    });

    it('fails soft: a rejected batch leaves the cache untouched and the ids retryable', async () => {
      service.getDownloads.mockRejectedValue(new Error('down'));

      await expect(store.resolveMany('g', 'c', ['1'])).resolves.toBeUndefined();
      expect(store.get('1')()).toBeUndefined();

      // The id is retryable afterwards (not stuck registered as in-flight).
      const meta = makeMeta('1');
      service.getDownload.mockResolvedValue(meta);
      expect(await store.resolve('g', 'c', '1')).toEqual(meta);
    });
  });
});
