import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { InviteService } from './invite.service';
import { environment } from '../../../environments/environment';

describe('InviteService', () => {
  let service: InviteService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [InviteService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InviteService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('createInvite() posts options and coerces string timestamps to numbers', async () => {
    const promise = service.createInvite('7', { maxUses: 5, expiresInSeconds: 3600 });

    const req = httpMock.expectOne(`${base}/guilds/7/invites`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ channelId: null, maxUses: 5, expiresInSeconds: 3600 });

    // The wire form serializes longs as strings (LongStringConverter).
    req.flush({
      code: 'aBc',
      guildId: '7',
      channelId: null,
      creatorId: '1',
      creatorUsername: 'owner',
      maxUses: 5,
      useCount: 0,
      expiresAt: '1782295146594',
      createdAt: '1782295110000',
    });

    const invite = await promise;
    expect(invite.code).toBe('aBc');
    expect(invite.expiresAt).toBe(1782295146594);
    expect(invite.createdAt).toBe(1782295110000);
  });

  it('createInvite() with no options sends nulls', async () => {
    const promise = service.createInvite('7');
    const req = httpMock.expectOne(`${base}/guilds/7/invites`);
    expect(req.request.body).toEqual({ channelId: null, maxUses: null, expiresInSeconds: null });
    req.flush({
      code: 'x',
      guildId: '7',
      channelId: null,
      creatorId: '1',
      creatorUsername: null,
      maxUses: null,
      useCount: 0,
      expiresAt: null,
      createdAt: '1782295110000',
    });
    const invite = await promise;
    expect(invite.expiresAt).toBeNull();
  });

  it('listInvites() coerces each row', async () => {
    const promise = service.listInvites('7');
    const req = httpMock.expectOne(`${base}/guilds/7/invites`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        code: 'a',
        guildId: '7',
        channelId: null,
        creatorId: '1',
        creatorUsername: 'o',
        maxUses: null,
        useCount: 2,
        expiresAt: null,
        createdAt: '100',
      },
    ]);
    const list = await promise;
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(100);
    expect(list[0].useCount).toBe(2);
  });

  it('deleteInvite() issues a DELETE to the guild-scoped route', async () => {
    const promise = service.deleteInvite('7', 'aBc');
    const req = httpMock.expectOne(`${base}/guilds/7/invites/aBc`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await promise;
  });

  it('preview() GETs the flat invite route', async () => {
    const promise = service.preview('aBc');
    const req = httpMock.expectOne(`${base}/invites/aBc`);
    expect(req.request.method).toBe('GET');
    req.flush({ code: 'aBc', guildId: '7', guildName: 'G', memberCount: 3, channelId: null });
    const preview = await promise;
    expect(preview.guildName).toBe('G');
  });

  it('join() POSTs to the redeem route and returns the guild', async () => {
    const promise = service.join('aBc');
    const req = httpMock.expectOne(`${base}/invites/aBc/join`);
    expect(req.request.method).toBe('POST');
    req.flush({
      id: '7',
      name: 'G',
      description: null,
      iconKey: null,
      bannerKey: null,
      isPublic: false,
      memberCount: 4,
      ownerId: '1',
    });
    const guild = await promise;
    expect(guild.id).toBe('7');
  });
});
