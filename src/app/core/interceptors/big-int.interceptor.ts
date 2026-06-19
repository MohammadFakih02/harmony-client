import { HttpInterceptorFn, HttpHandlerFn, HttpRequest, HttpEvent, HttpResponse } from '@angular/common/http';
import { map } from 'rxjs';

// Snowflake IDs are ~18 digits and exceed Number.MAX_SAFE_INTEGER (16 digits).
// JSON.parse turns them into imprecise floats, corrupting every URL/lookup.
// This interceptor re-parses the raw response text, quoting bare 16+-digit integers
// that sit in JSON *value position* so they stay precise strings.
//
// CRITICAL: only match numbers preceded by a structural char (`:`, `[`, `,`) and
// followed by one (`,`, `}`, `]`). A naive "any 16+ digit run" match also rewrites
// snowflakes embedded inside string values — e.g. the path segments of a presigned
// upload URL (".../attachments/325.../326...") — injecting quotes mid-string and
// breaking JSON.parse. That silently failed every file upload.
const LARGE_INT_RE = /([\[:,]\s*)(\d{16,})(?=\s*[,}\]])/g;

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

      // Quote every value-position 16+-digit integer so JSON.parse keeps it as a string
      const patched = body.replace(LARGE_INT_RE, '$1"$2"');
      return event.clone({ body: JSON.parse(patched) });
    }),
  ) as ReturnType<typeof next>;
};
