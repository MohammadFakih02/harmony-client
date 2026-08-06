import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, timer } from 'rxjs';

// Why this exists:
// A hard page refresh fires the whole bootstrap burst at once — guilds, channels, messages,
// friends, members, DMs, notifications, unread (~12+ concurrent requests) — all racing the fresh
// HTTP connection. Any one that hits a transient failure (a dropped/aborted connection => status 0,
// or a 5xx) gets swallowed by its store's `catch {}` into empty state, with nothing to retry it. The
// result is the intermittent "nothing loaded after refresh" (servers/friends/members/messages blank)
// that only a manual refresh clears. This interceptor makes a transient blip self-heal.
//
// Scope: GET requests + POST /auth/refresh on 429 only.
// - Other writes are never retried — a retry could duplicate a side effect (double-send, etc.).
// - POST /auth/refresh is extended for 429 only: the rate limiter rejects the request before any
//   token rotation logic runs, so retrying is safe. Without this, 11+ rapid page refreshes exhaust
//   the anonymous rate-limit window (20/10s) and cause a spurious logout — the refresh cookie is
//   still valid, but _doRefresh()'s catch{} treats the 429 as a fatal auth failure.
// - Transient/5xx on /auth/refresh are NOT retried — those could indicate partial handler execution.
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  const isAuthRefresh = req.method === 'POST' && req.url.includes('/auth/refresh');
  if (req.method !== 'GET' && !isAuthRefresh) return next(req);

  return next(req).pipe(
    retry({
      count: 3,
      delay: (error, retryCount) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;

        // 429 (rate limited): wait the server's Retry-After then retry. Safe for both GET and
        // POST /auth/refresh because a 429 guarantees the request was rejected before any handler
        // logic ran. Do NOT hammer — that only deepens the limit.
        if (status === 429) {
          const hdr = error instanceof HttpErrorResponse ? Number(error.headers.get('Retry-After')) : NaN;
          const seconds = Number.isFinite(hdr) && hdr > 0 ? hdr : 2;
          return timer(Math.min(seconds, 6) * 1000);
        }

        // POST /auth/refresh: only retry on 429 (above). Transient/5xx could mean the token
        // partially rotated — don't retry those; let _doRefresh()'s catch handle them.
        if (isAuthRefresh) throw error;

        // GET requests: retry on transient failures (network/aborted, timeout, 5xx).
        const isTransient = status === 0 || status === 408 || (status >= 500 && status <= 599);
        if (!isTransient) throw error;
        return timer(250 * 2 ** (retryCount - 1));
      },
    }),
  );
};
