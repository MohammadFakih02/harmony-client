import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { bigIntInterceptor } from './big-int.interceptor';

describe('bigIntInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bigIntInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function respond(body: string): Promise<any> {
    const p = new Promise<any>((resolve) => http.get('/x').subscribe(resolve));
    const req = httpMock.expectOne('/x');
    // The interceptor switches the request to text; respond with raw JSON text.
    req.flush(body);
    return p;
  }

  it('quotes value-position 16+ digit ids so they survive as strings', async () => {
    const body = await respond('{"id":325582201976520704,"name":"g"}');
    expect(body.id).toBe('325582201976520704');
  });

  it('quotes ids inside arrays', async () => {
    const body = await respond('{"attachmentIds":[325591049474932737,325591049474932738]}');
    expect(body.attachmentIds).toEqual(['325591049474932737', '325591049474932738']);
  });

  it('leaves sub-16-digit numbers (timestamps) as numbers', async () => {
    const body = await respond('{"messageId":325591049474932736,"sentAt":1781692045976}');
    expect(body.messageId).toBe('325591049474932736');
    expect(body.sentAt).toBe(1781692045976);
  });

  it('does NOT corrupt snowflakes embedded in a string value (presigned upload URL)', async () => {
    // This is the regression: a naive regex quoted the path segments, breaking JSON.parse
    // and silently failing every upload.
    const url =
      'http://localhost:9000/harmony/attachments/325582201976520704/325582202408534016/326028574769283072?X=1781798770&S=ab%2Bc';
    const body = await respond(`{"fileId":"326028574769283072","uploadUrl":"${url}"}`);
    expect(body.uploadUrl).toBe(url);
    expect(body.fileId).toBe('326028574769283072');
  });

  it('does not double-quote already-quoted ids', async () => {
    const body = await respond('{"attachmentIds":["325591049474932737"]}');
    expect(body.attachmentIds).toEqual(['325591049474932737']);
  });

  it('handles empty arrays', async () => {
    const body = await respond('{"attachmentIds":[],"mentionIds":[]}');
    expect(body.attachmentIds).toEqual([]);
  });
});
