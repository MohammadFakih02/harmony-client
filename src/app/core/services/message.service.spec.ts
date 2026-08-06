import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageService } from './message.service';
import { environment } from '../../../environments/environment';

describe('MessageService — pins', () => {
  let service: MessageService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MessageService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MessageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getPins() GETs the nested guild pins endpoint', async () => {
    const promise = service.getPins('7', '42');
    const req = httpMock.expectOne(`${base}/guilds/7/channels/42/pins`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
    expect(await promise).toEqual([]);
  });

  it('getPins() uses the DM base when guildId is null', () => {
    service.getPins(null, '42');
    const req = httpMock.expectOne(`${base}/dm/42/pins`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('pinMessage() PUTs the pin endpoint', () => {
    service.pinMessage('7', '42', '99');
    const req = httpMock.expectOne(`${base}/guilds/7/channels/42/pins/99`);
    expect(req.request.method).toBe('PUT');
    req.flush(null);
  });

  it('pinMessage() uses the DM base when guildId is null', () => {
    service.pinMessage(null, '42', '99');
    const req = httpMock.expectOne(`${base}/dm/42/pins/99`);
    expect(req.request.method).toBe('PUT');
    req.flush(null);
  });

  it('unpinMessage() DELETEs the pin endpoint', () => {
    service.unpinMessage('7', '42', '99');
    const req = httpMock.expectOne(`${base}/guilds/7/channels/42/pins/99`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
