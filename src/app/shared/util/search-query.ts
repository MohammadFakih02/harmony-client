/**
 * Pure parsing for Discord-style search operators (`from:`, `in:`, `has:`, `before:`, `after:`,
 * `during:`). The search panel resolves the parsed tokens against its member/channel stores and sends
 * typed filters to the API; this file holds only the string↔structure logic so it can be unit-tested
 * in isolation. No Angular, no I/O.
 */

export type SearchOperator = 'from' | 'in' | 'has' | 'before' | 'after' | 'during';

/** Order here is the order operator-name suggestions are offered in. */
export const SEARCH_OPERATORS: readonly SearchOperator[] = [
  'from',
  'in',
  'has',
  'before',
  'after',
  'during',
];

const OP_SET = new Set<string>(SEARCH_OPERATORS);

export interface SearchToken {
  op: SearchOperator;
  value: string;
}

export interface ParsedQuery {
  /** Free-text remainder with every operator stripped out (single-spaced). */
  text: string;
  tokens: SearchToken[];
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n';

/**
 * Splits a raw query into free text + operator tokens. An `op:value` segment whose op is recognised
 * becomes a token (value may be `"double quoted"` to hold spaces); anything else — including a
 * bare `word`, a `http://…` URL, or an unknown `foo:bar` — stays in the free text. An operator with
 * an empty value (e.g. a half-typed `from:`) contributes no token.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const tokens: SearchToken[] = [];
  const textParts: string[] = [];
  let i = 0;

  while (i < raw.length) {
    if (isSpace(raw[i])) {
      i++;
      continue;
    }

    const opMatch = /^([a-z]+):/i.exec(raw.slice(i));
    if (opMatch && OP_SET.has(opMatch[1].toLowerCase())) {
      const op = opMatch[1].toLowerCase() as SearchOperator;
      i += opMatch[0].length;

      let value = '';
      if (raw[i] === '"') {
        i++; // opening quote
        while (i < raw.length && raw[i] !== '"') value += raw[i++];
        if (raw[i] === '"') i++; // closing quote
      } else {
        while (i < raw.length && !isSpace(raw[i])) value += raw[i++];
      }

      if (value.length > 0) tokens.push({ op, value });
      continue;
    }

    // Plain word (or unknown operator) — consume to the next space, keep as free text.
    let word = '';
    while (i < raw.length && !isSpace(raw[i])) word += raw[i++];
    textParts.push(word);
  }

  return { text: textParts.join(' '), tokens };
}

/** Serialises a parsed query back to a string (operators first, then free text). Used when a chip is
 *  removed — the input is rewritten to the normalised form. */
export function serializeSearchQuery(parsed: ParsedQuery): string {
  const toks = parsed.tokens.map(
    (t) => `${t.op}:${/\s/.test(t.value) ? `"${t.value}"` : t.value}`,
  );
  return [...toks, parsed.text].filter((s) => s.length > 0).join(' ');
}

export interface ActiveFragment {
  /** `operator` = the user is typing an operator name; `value` = typing an operator's value. */
  kind: 'operator' | 'value';
  op?: SearchOperator;
  /** Lower-cased partial to filter suggestions by. */
  partial: string;
  /** Index in the raw string where this fragment starts (for in-place replacement). */
  start: number;
}

/**
 * Inspects the trailing segment of the raw string (what the caret is on, assuming end-of-input) to
 * decide whether — and which — suggestions to offer. Returns null when nothing suggestable is being
 * typed (e.g. a plain word, or a value already closed with a quote).
 */
export function activeFragment(raw: string): ActiveFragment | null {
  const frag = /(\S*)$/.exec(raw)?.[1] ?? '';
  if (frag.length === 0) return null;
  const start = raw.length - frag.length;

  const opMatch = /^([a-z]+):(.*)$/i.exec(frag);
  if (opMatch && OP_SET.has(opMatch[1].toLowerCase())) {
    const rawVal = opMatch[2];
    // A fully quoted value ("...") is complete — stop suggesting.
    if (rawVal.length >= 2 && rawVal.startsWith('"') && rawVal.endsWith('"')) return null;
    const partial = rawVal.replace(/^"/, '');
    return { kind: 'value', op: opMatch[1].toLowerCase() as SearchOperator, partial: partial.toLowerCase(), start };
  }

  // A bare word that could be the start of an operator name → offer operator suggestions.
  if (/^[a-z]+$/i.test(frag) && SEARCH_OPERATORS.some((o) => o.startsWith(frag.toLowerCase()))) {
    return { kind: 'operator', partial: frag.toLowerCase(), start };
  }

  return null;
}

export interface DateSpan {
  /** Inclusive lower bound, unix-ms. */
  start: number;
  /** Exclusive upper bound, unix-ms. */
  end: number;
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Parses a date-operator value into a local-time `[start, end)` span. Accepts `today`, `yesterday`,
 * `YYYY`, `YYYY-MM`, and `YYYY-MM-DD`. Returns null for anything unrecognised (the operator is then
 * ignored rather than silently mangling the query).
 */
export function parseDateValue(value: string): DateSpan | null {
  const v = value.trim().toLowerCase();
  if (v === 'today') {
    const s = startOfDay(new Date());
    return { start: s, end: s + DAY_MS };
  }
  if (v === 'yesterday') {
    const s = startOfDay(new Date()) - DAY_MS;
    return { start: s, end: s + DAY_MS };
  }

  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const date = new Date(y, mo - 1, d);
    // Reject rolled-over nonsense (e.g. 2026-13-40 → next year): the Date must round-trip.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    const start = date.getTime();
    return { start, end: start + DAY_MS };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(v))) {
    const mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return { start: new Date(+m[1], mo - 1, 1).getTime(), end: new Date(+m[1], mo, 1).getTime() };
  }
  if ((m = /^(\d{4})$/.exec(v))) {
    return { start: new Date(+m[1], 0, 1).getTime(), end: new Date(+m[1] + 1, 0, 1).getTime() };
  }
  return null;
}
