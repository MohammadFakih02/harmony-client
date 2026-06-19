const GENERIC = 'Something went wrong. Please try again.';

/**
 * Turns an HTTP error into a human-readable message, handling every shape the
 * Harmony backend actually emits:
 *  - ValidationProblemDetails → `error.errors` is a dict { field: string[] }
 *    (from ValidationActionFilter)
 *  - ProblemDetails → `error.detail` (from GlobalExceptionHandler — auth/business errors)
 *  - `{ error: string }` → the bare shape /auth/refresh returns
 * Falls back by status code for transport-level failures (offline / rate limited).
 *
 * Duck-typed (checks for `status` + `error`) rather than `instanceof HttpErrorResponse`
 * so it stays correct regardless of how the error was wrapped on its way here.
 */
export function extractApiError(err: unknown): string {
  const e = err as { status?: number; error?: unknown } | null;
  if (!e || typeof e !== 'object' || !('status' in e)) return GENERIC;

  // The response body. Angular usually parses JSON into an object, but if it ever
  // arrives as a raw string, try to parse it.
  let body = e.error as Record<string, unknown> | string | null | undefined;
  if (typeof body === 'string') {
    const raw = body;
    try {
      body = JSON.parse(raw);
    } catch {
      // Non-JSON string body — use it directly if it looks like a message.
      return raw.trim().length ? raw : GENERIC;
    }
  }

  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;

    // ValidationProblemDetails: errors is a non-array object of field → messages[]
    if (b['errors'] && typeof b['errors'] === 'object' && !Array.isArray(b['errors'])) {
      const messages = Object.values(b['errors'] as Record<string, string[]>)
        .flat()
        .filter((m): m is string => typeof m === 'string' && m.length > 0);
      if (messages.length) return messages.join(' ');
    }

    // ProblemDetails (auth/business errors carry the message in `detail`)
    if (typeof b['detail'] === 'string' && (b['detail'] as string).length) {
      return b['detail'] as string;
    }

    // The bare { error: "..." } shape (e.g. /auth/refresh "No refresh token.")
    if (typeof b['error'] === 'string' && (b['error'] as string).length) {
      return b['error'] as string;
    }
  }

  // Transport-level fallbacks
  if (e.status === 0) return "Can't reach the server. Check your connection.";
  if (e.status === 429) return 'Too many attempts. Please wait a moment and try again.';

  return GENERIC;
}
