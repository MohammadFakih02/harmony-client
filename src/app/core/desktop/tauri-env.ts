// Desktop (Tauri) environment bridge.
//
// The web build addresses the API/SignalR with SAME-ORIGIN RELATIVE paths (see
// environments/environment.ts) because a reverse proxy sits in front of the browser
// origin. That also holds under `tauri dev` — the webview runs on http://localhost:4200
// and `npm start`'s proxy.conf.json forwards /api + /hubs to the local backend — so auth
// there is same-origin and works with no extra config.
//
// A PACKAGED desktop build serves its assets from http://tauri.localhost, a DIFFERENT
// origin than the API, so it must call an ABSOLUTE URL. Set DESKTOP_API_ORIGIN below to
// your remote server's origin (scheme + host, no trailing slash) when you build the
// installable app; leave it EMPTY to keep relative URLs (the correct setting for `tauri
// dev` against your local stack, which is how we run the auth spike first).
import { environment } from '../../../environments/environment';

// e.g. 'https://harmony.example.com'  — leave '' to use same-origin relative URLs.
const DESKTOP_API_ORIGIN: string = '';
// e.g. 'wss://livekit.example.com'    — leave '' to keep environment.liveKitUrl.
const DESKTOP_LIVEKIT_URL: string = '';

/** True when running inside the Tauri webview (both `tauri dev` and a packaged build). */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || 'isTauri' in window)
  );
}

/**
 * Rewrites the shared `environment` for the desktop app. Call ONCE before bootstrap so
 * every service reads the final values. No-op on the web build and when no origin is set.
 */
export function applyDesktopEnvironment(): void {
  if (!isTauri()) return;
  document.documentElement.classList.add('tauri');
  if (DESKTOP_API_ORIGIN) {
    const base = DESKTOP_API_ORIGIN.replace(/\/+$/, '');
    environment.apiUrl = `${base}/api`;
    environment.signalRUrl = `${base}/hubs`;
  }
  if (DESKTOP_LIVEKIT_URL) {
    environment.liveKitUrl = DESKTOP_LIVEKIT_URL;
  }
}

/**
 * Invokes a Tauri (Rust) command, folding in the desktop guard + swallow-on-error that every caller
 * otherwise repeats. Returns `undefined` on the web build or on any failure. The dynamic import is
 * memoized by the module loader, so repeat calls are cheap.
 */
export async function tauriInvoke<T = void>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}
