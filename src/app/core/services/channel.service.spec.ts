import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChannelService } from './channel.service';
import { environment } from '../../../environments/environment';

describe('ChannelService — permission overrides', () => {
  let service: ChannelService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;
  const url = `${base}/guilds/7/channels/42/overrides`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ChannelService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChannelService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listOverrides() GETs and coerces ids to strings and bits to numbers', async () => {
    const promise = service.listOverrides('7', '42');
    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('GET');
    // REST serializes longs as JSON numbers — the service must normalize either form.
    req.flush([
      { id: 1, channelId: 42, targetId: 9, targetType: 'role', allowBits: 257, denyBits: 0 },
      { id: '2', channelId: '42', targetId: '8', targetType: 'user', allowBits: '0', denyBits: '256' },
    ]);
    expect(await promise).toEqual([
      { id: '1', channelId: '42', targetId: '9', targetType: 'role', allowBits: 257, denyBits: 0 },
      { id: '2', channelId: '42', targetId: '8', targetType: 'user', allowBits: 0, denyBits: 256 },
    ]);
  });

  it('upsertOverride() PUTs the target route with type + bit masks in the body', async () => {
    const promise = service.upsertOverride('7', '42', '9', {
      targetType: 'role',
      allowBits: 1,
      denyBits: 256,
    });
    const req = httpMock.expectOne(`${url}/9`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ targetType: 'role', allowBits: 1, denyBits: 256 });
    req.flush({ id: 1, channelId: 42, targetId: 9, targetType: 'role', allowBits: 1, denyBits: 256 });
    expect(await promise).toEqual({
      id: '1',
      channelId: '42',
      targetId: '9',
      targetType: 'role',
      allowBits: 1,
      denyBits: 256,
    });
  });

  it('deleteOverride() DELETEs the target route', () => {
    service.deleteOverride('7', '42', '9');
    const req = httpMock.expectOne(`${url}/9`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
