/**
 * Recently-used emoji, persisted to localStorage so the composer picker can surface them first.
 * Pure functions over a single key — no Angular dependency, so they're trivially unit-testable and
 * safe to call from a component without a store. Fail-soft: any storage error degrades to "no
 * recents" rather than throwing into the UI.
 */
const STORAGE_KEY = 'harmony-emoji-recents';
const MAX_RECENTS = 24;

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Moves `char` to the front (de-duplicating), caps the list, and persists. Returns the new list. */
export function pushRecent(char: string): string[] {
  const next = [char, ...getRecents().filter((c) => c !== char)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota) — recents just won't persist this session.
  }
  return next;
}
