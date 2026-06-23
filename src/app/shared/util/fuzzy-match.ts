/**
 * Lightweight fuzzy matcher for mention autocomplete. Returns a rank score for how well
 * `query` matches `target` (both compared case-insensitively), or null for no match.
 * Higher is better. Tiers, best first:
 *   3 — prefix      ("owner" → "owner…")
 *   2 — substring   ("owner" → "seed_owner")
 *   1 — subsequence ("seed_oner" → "seed_owner": chars appear in order, tolerates a
 *                    dropped/extra character — the common typo)
 * An empty query matches everything at the top tier (the full pool shows).
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return 3;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  return isSubsequence(q, t) ? 1 : null;
}

/** True if every char of `q` appears in `t` in order (not necessarily contiguously). */
function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * Filters + ranks items by how well their searchable text matches `query`. Stable within a
 * tier (preserves input order, e.g. an existing sort). `text` extracts the string to match.
 */
export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; index: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
