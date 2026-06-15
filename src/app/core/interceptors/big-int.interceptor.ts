import { HttpInterceptorFn, HttpHandlerFn, HttpRequest, HttpEvent, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs';

// Snowflake IDs are ~18 digits and exceed Number.MAX_SAFE_INTEGER (16 digits).
// JSON.parse turns them into imprecise floats, corrupting every URL/lookup.
// This interceptor re-parses the raw response text, quoting all standalone
// integers of 16+ digits so they stay as precise strings in the app.
const LARGE_INT_RE = /(?<!["\w])(\d{16,})(?![\w"])/g;

export const bigIntInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  // Request raw text so Angular doesn't JSON.parse before we can intercept
  const textReq = req.clone({ responseType: 'text' as const });

  return next(textReq as HttpRequest<unknown>).pipe(
    map((event: HttpEvent<unknown>) => {
      if (!(event instanceof HttpResponse) || typeof event.body !== 'string') {
        return event;
      }

      const body = event.body.trim();
      if (!body.startsWith('{') && !body.startsWith('[')) {
        // Not JSON — return as-is (e.g. empty 204 body or plain text)
        return event.clone({ body: body || null });
      }

      // Quote every bare 16+-digit integer so JSON.parse keeps it as a string
      const patched = body.replace(LARGE_INT_RE, '"$1"');
      return event.clone({ body: JSON.parse(patched) });
    }),
  ) as ReturnType<typeof next>;
};
