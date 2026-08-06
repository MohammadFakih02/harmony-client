import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuditLogService } from './audit-log.service';
import { environment } from '../../../environments/environment';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuditLogService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuditLogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getAuditLog() coerces string timestamps and keeps ids as strings', async () => {
    const promise = service.getAuditLog('7');

    const req = httpMock.expectOne(`${base}/guilds/7/audit-log`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        id: '900',
        actorId: '1',
        actorUsername: 'owner',
        actorAvatarKey: null,
        actionType: 'member_ban',
        targetId: '42',
        changes: null,
        reason: 'spam',
        createdAt: '1782295110000',
      },
    ]);

    const entries = await promise;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('900');
    expect(entries[0].targetId).toBe('42');
    expect(entries[0].createdAt).toBe(1782295110000);
    expect(entries[0].reason).toBe('spam');
  });

  it('getAuditLog() forwards before + action query params', async () => {
    const promise = service.getAuditLog('7', { before: '900', action: 'role_create' });

    const req = httpMock.expectOne(
      (r) =>
        r.url === `${base}/guilds/7/audit-log` &&
        r.params.get('before') === '900' &&
        r.params.get('action') === 'role_create',
    );
    req.flush([]);

    expect(await promise).toEqual([]);
  });
});
