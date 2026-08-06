import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SearchService } from './search.service';
import { environment } from '../../../environments/environment';

describe('SearchService', () => {
  let service: SearchService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SearchService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SearchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('search() hits the guild search endpoint with the query', async () => {
    const promise = service.search('7', 'pineapple');

    const req = httpMock.expectOne((r) => r.url === `${base}/guilds/7/search`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('pineapple');
    expect(req.request.params.has('channelId')).toBe(false);
    expect(req.request.params.has('before')).toBe(false);

    req.flush({ results: [], hasMore: false });
    await promise;
  });

  it('search() forwards channelId and before cursor when provided', async () => {
    const promise = service.search('7', 'kiwi', { channelId: '42', before: 1782295110000 });

    const req = httpMock.expectOne((r) => r.url === `${base}/guilds/7/search`);
    expect(req.request.params.get('q')).toBe('kiwi');
    expect(req.request.params.get('channelId')).toBe('42');
    expect(req.request.params.get('before')).toBe('1782295110000');

    req.flush({ results: [], hasMore: true });
    const results = await promise;
    expect(results.hasMore).toBe(true);
  });

  it('searchDmChannel() hits the DM channel-scoped endpoint', async () => {
    const promise = service.searchDmChannel('99', 'mango', { before: 1782295110000 });

    const req = httpMock.expectOne((r) => r.url === `${base}/dm/99/search`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('mango');
    expect(req.request.params.get('before')).toBe('1782295110000');
    expect(req.request.params.has('channelId')).toBe(false);

    req.flush({ results: [], hasMore: false });
    await promise;
  });
});
