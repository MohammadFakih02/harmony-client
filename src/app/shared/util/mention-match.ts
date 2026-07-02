/**
 * Client mirror of the backend `MentionParser` longest-match resolver (Harmony.Application). At an
 * `@`, it finds the longest candidate name (username / server nickname / role name — any of which may
 * contain spaces) that is a case-insensitive prefix of the following text and is terminated by
 * end-of-string or a non-username character. Used by the markdown renderer to decide which `@…` runs
 * become chips (and to colour role chips). Keeping the rule identical to the server means what renders
 * as a chip is exactly what the server actually notified on.
 */
export type MentionKind = 'user' | 'role' | 'everyone' | 'here';

export interface MentionSets {
  /** Lowercased usernames + server nicknames eligible to render as user chips. */
  users: Set<string>;
  /** Lowercased role name → hex colour (null = uncoloured). */
  roles: Map<string, string | null>;
  /** Longest candidate length — bounds the scan after each '@'. */
  maxLen: number;
}

export interface MentionContext {
  sets: MentionSets;
  /** @everyone / @here + role mentions are guild-only concepts. */
  guild: boolean;
}

export interface MentionMatch {
  /** Number of characters AFTER the '@' that the mention spans. */
  length: number;
  kind: MentionKind;
  /** Role colour (hex) for a role chip; null otherwise. */
  color: string | null;
}

const isNameChar = (c: string): boolean => /[A-Za-z0-9\-._+]/.test(c);

/** Assembles the lookup sets (lowercased) + the max candidate length for {@link matchMentionAt}. */
export function buildMentionSets(
  userNames: Iterable<string>,
  roles: Iterable<{ name: string; color: string | null }>,
): MentionSets {
  const users = new Set<string>();
  let maxLen = 0;
  for (const n of userNames) {
    const k = n.toLowerCase();
    users.add(k);
    if (k.length > maxLen) maxLen = k.length;
  }
  const roleMap = new Map<string, string | null>();
  for (const r of roles) {
    const k = r.name.toLowerCase();
    roleMap.set(k, r.color);
    if (k.length > maxLen) maxLen = k.length;
  }
  return { users, roles: roleMap, maxLen };
}

/**
 * If a mention starts at `content[at]` (which must be `@`), returns the match (length + kind +
 * colour); otherwise null. User matches beat role matches on an exact-length tie.
 */
export function matchMentionAt(content: string, at: number, ctx: MentionContext): MentionMatch | null {
  const start = at + 1;

  // @everyone / @here — the spaceless name-char run only, guild-only.
  let runEnd = start;
  while (runEnd < content.length && isNameChar(content[runEnd])) runEnd++;
  if (ctx.guild && runEnd > start) {
    const run = content.slice(start, runEnd).toLowerCase();
    if (run === 'everyone') return { length: runEnd - start, kind: 'everyone', color: null };
    if (run === 'here') return { length: runEnd - start, kind: 'here', color: null };
  }

  const limit = Math.min(ctx.sets.maxLen, content.length - start);
  for (let len = limit; len >= 1; len--) {
    const end = start + len;
    if (end < content.length && isNameChar(content[end])) continue; // not a boundary
    const name = content.slice(start, end).toLowerCase();
    if (ctx.sets.users.has(name)) return { length: len, kind: 'user', color: null };
    if (ctx.sets.roles.has(name)) return { length: len, kind: 'role', color: ctx.sets.roles.get(name) ?? null };
  }
  return null;
}
