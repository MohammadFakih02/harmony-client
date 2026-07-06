import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PushService, urlBase64ToUint8Array } from './push.service';
import { environment } from '../../../environments/environment';

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 key into raw bytes', () => {
    // 'Zm9vYmFy' = "foobar"; use -/_ variants to prove the URL-safe mapping.
    const bytes = urlBase64ToUint8Array('Zm9vYmFy');
    expect(Array.from(bytes)).toEqual([102, 111, 111, 98, 97, 114]);
  });

  it('re-pads truncated input and maps - and _ back to + and /', () => {
    // btoa('\xfb\xff\xbf') = '+/+/' → URL-safe '-_-_'; unpadded lengths must be re-padded.
    const bytes = urlBase64ToUint8Array('-_-_');
    expect(Array.from(bytes)).toEqual([251, 255, 191]);
  });
});

describe('PushService HTTP', () => {
  let service: PushService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PushService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PushService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetchPublicKey() GETs the VAPID key', async () => {
    const promise = service.fetchPublicKey();

    const req = httpMock.expectOne(`${base}/notifications/push/public-key`);
    expect(req.request.method).toBe('GET');
    req.flush({ publicKey: 'BKey' });

    expect((await promise).publicKey).toBe('BKey');
  });

  it('saveSubscription() PUTs the flattened endpoint + keys', async () => {
    const promise = service.saveSubscription({
      endpoint: 'https://push.example/e1',
      keys: { p256dh: 'pk', auth: 'ak' },
    });

    const req = httpMock.expectOne(`${base}/notifications/push-subscription`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      endpoint: 'https://push.example/e1',
      p256dh: 'pk',
      authKey: 'ak',
    });
    req.flush(null);
    await promise;
  });

  it('deleteSubscription() DELETEs with the endpoint as a query param', async () => {
    const promise = service.deleteSubscription('https://push.example/e1?x=1');

    const req = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url === `${base}/notifications/push-subscription`,
    );
    expect(req.request.params.get('endpoint')).toBe('https://push.example/e1?x=1');
    req.flush(null);
    await promise;
  });
});
