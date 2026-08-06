import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReactionService } from './reaction.service';
import { environment } from '../../../environments/environment';

describe('ReactionService', () => {
  let service: ReactionService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ReactionService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReactionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('add() PUTs the nested guild reactions endpoint with the emoji in the body', () => {
    service.add('7', '42', '99', '😀');
    const req = httpMock.expectOne(`${base}/guilds/7/channels/42/messages/99/reactions`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ emoji: '😀' });
    req.flush(null);
  });

  it('add() uses the DM base when guildId is null', () => {
    service.add(null, '42', '99', '🔥');
    const req = httpMock.expectOne(`${base}/dm/42/messages/99/reactions`);
    expect(req.request.method).toBe('PUT');
    req.flush(null);
  });

  it('remove() DELETEs with the emoji as a query param (never a path segment)', () => {
    service.remove('7', '42', '99', '😀');
    const req = httpMock.expectOne(
      (r) => r.url === `${base}/guilds/7/channels/42/messages/99/reactions`,
    );
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('emoji')).toBe('😀');
    req.flush(null);
  });

  it('remove() uses the DM base when guildId is null', () => {
    service.remove(null, '42', '99', '🔥');
    const req = httpMock.expectOne(
      (r) => r.url === `${base}/dm/42/messages/99/reactions`,
    );
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('emoji')).toBe('🔥');
    req.flush(null);
  });
});
