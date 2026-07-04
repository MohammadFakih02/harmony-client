/**
 * A small Discord-style markdown subset parser. Produces a node tree that the MessageContent
 * component renders with Angular interpolation only (never innerHTML) — so it's XSS-safe by
 * construction, needs no sanitizer, and folds @-mentions in as a node type so chips keep working.
 *
 * Supported: **bold**, *italic* / _italic_, __underline__, ~~strike~~, `inline code`,
 * ```code blocks``` (optionally fenced with a language), and ||spoiler||. Code spans/blocks are
 * literal — no markdown or mentions are parsed inside them. Unmatched delimiters render as plain
 * text. Block-level constructs (blockquotes, lists, headings) are intentionally out of scope.
 *
 * The node shape uses optional fields (rather than a discriminated union) so Angular's template
 * type-checker can read node.text / node.children / node.lang in an @switch without narrowing.
 */
import { MentionContext, matchMentionAt } from './mention-match';

export type MdNodeType =
  | 'text'
  | 'mention'
  | 'link'
  | 'code'
  | 'codeblock'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'spoiler';

export interface MdNode {
  type: MdNodeType;
  text?: string;
  lang?: string | null;
  children?: MdNode[];
  /** For 'mention' nodes: whether it's a role mention (coloured) vs a user/@everyone chip. */
  mentionRole?: boolean;
  /** For a role 'mention' node: the role's hex colour, or null. */
  color?: string | null;
}

type ContainerType = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';

// Multi-char delimiters are listed BEFORE the single-char ones so `**` wins over `*` (and `__`
// over `_`) when both could match at a position.
const DELIMS: { open: string; type: ContainerType }[] = [
  { open: '**', type: 'bold' },
  { open: '__', type: 'underline' },
  { open: '~~', type: 'strike' },
  { open: '||', type: 'spoiler' },
  { open: '*', type: 'italic' },
  { open: '_', type: 'italic' },
];

function matchDelim(s: string, i: number): { open: string; type: ContainerType } | null {
  for (const d of DELIMS) {
    if (s.startsWith(d.open, i)) return d;
  }
  return null;
}

// Only literal http(s):// URLs ever become links — javascript:/data: etc. can never match.
const URL_RE = /^https?:\/\/[^\s]+/;
// Sentence punctuation that shouldn't be swallowed when a message ends "…see https://x.com."
const TRAILING_PUNCT = new Set(['.', ',', ':', ';', '!', '?', '"', "'"]);

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** Matches a URL starting at index i, with trailing sentence punctuation (and unbalanced
 *  closing brackets) trimmed off. Returns the URL text, or null. */
function matchUrlAt(s: string, i: number): string | null {
  const m = URL_RE.exec(s.slice(i));
  if (!m) return null;
  let url = m[0];
  for (;;) {
    const last = url[url.length - 1];
    if (TRAILING_PUNCT.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    // Trim a closing bracket only while the URL holds more closers than openers, so
    // wiki-style urls like /Foo_(bar) keep their balanced paren.
    if ((last === ')' && count(url, ')') > count(url, '(')) ||
        (last === ']' && count(url, ']') > count(url, '['))) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  // "https://" alone (or fully trimmed away) isn't a link.
  return /^https?:\/\/./.test(url) ? url : null;
}

/** Index of the matching close marker, or -1. For single-char markers, occurrences that are part
 *  of a doubled marker (** / __) are skipped so a `*` close doesn't land inside a `**`. */
function findClose(s: string, from: number, open: string): number {
  if (open.length === 2) return s.indexOf(open, from);
  let idx = from;
  while (idx < s.length) {
    idx = s.indexOf(open, idx);
    if (idx === -1) return -1;
    if (s[idx + 1] === open) {
      idx += 2; // part of '**' / '__' — skip both chars
      continue;
    }
    return idx;
  }
  return -1;
}

function parseInline(s: string, ctx: MentionContext): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;
  let textStart = 0;
  const flush = (end: number): void => {
    if (end > textStart) out.push({ type: 'text', text: s.slice(textStart, end) });
  };

  while (i < s.length) {
    const c = s[i];

    // Inline code — literal, no nested parsing. Requires a non-empty span.
    if (c === '`') {
      const close = s.indexOf('`', i + 1);
      if (close > i + 1) {
        flush(i);
        out.push({ type: 'code', text: s.slice(i + 1, close) });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    // Mention — chip for @everyone/@here, a known user (username or nickname), or a role name.
    // Uses the shared longest-match resolver so multi-word nicknames/roles chip correctly.
    if (c === '@') {
      const match = matchMentionAt(s, i, ctx);
      if (match) {
        flush(i);
        const end = i + 1 + match.length;
        out.push({
          type: 'mention',
          text: s.slice(i, end),
          mentionRole: match.kind === 'role',
          color: match.kind === 'role' ? match.color : null,
        });
        i = end;
        textStart = i;
        continue;
      }
    }

    // Bare URL — consumed as a single node BEFORE delimiter matching, so `_`/`*`/`~~` inside
    // a URL are never misread as formatting. Only http(s):// ever links (XSS-safe).
    if (c === 'h' && (s.startsWith('http://', i) || s.startsWith('https://', i))) {
      const url = matchUrlAt(s, i);
      if (url) {
        flush(i);
        out.push({ type: 'link', text: url });
        i += url.length;
        textStart = i;
        continue;
      }
    }

    // Delimited span (bold/italic/underline/strike/spoiler) — recurse into the inner content.
    const d = matchDelim(s, i);
    if (d) {
      const innerStart = i + d.open.length;
      const close = findClose(s, innerStart, d.open);
      if (close > innerStart) {
        flush(i);
        out.push({ type: d.type, children: parseInline(s.slice(innerStart, close), ctx) });
        i = close + d.open.length;
        textStart = i;
        continue;
      }
    }

    i++;
  }
  flush(s.length);
  return out;
}

/** Parses message content into a renderable node tree. Code blocks (```…```) are extracted first
 *  and kept literal; everything between them is parsed inline. */
export function parseMarkdown(content: string, ctx: MentionContext): MdNode[] {
  const nodes: MdNode[] = [];
  let i = 0;
  let segStart = 0;

  while (i < content.length) {
    if (content.startsWith('```', i)) {
      const close = content.indexOf('```', i + 3);
      if (close !== -1) {
        if (i > segStart) nodes.push(...parseInline(content.slice(segStart, i), ctx));

        let body = content.slice(i + 3, close);
        let lang: string | null = null;
        const nl = body.indexOf('\n');
        if (nl !== -1) {
          const firstLine = body.slice(0, nl).trim();
          // A bare word on the fence line is the language; otherwise it's the first line of code.
          if (firstLine.length > 0 && /^[A-Za-z0-9+#.\-]+$/.test(firstLine)) {
            lang = firstLine;
            body = body.slice(nl + 1);
          } else {
            body = body.replace(/^\n/, ''); // newline right after the fence, no language
          }
        }
        body = body.replace(/\n$/, ''); // drop the newline before the closing fence

        nodes.push({ type: 'codeblock', text: body, lang });
        i = close + 3;
        segStart = i;
        continue;
      }
    }
    i++;
  }

  if (segStart < content.length) {
    nodes.push(...parseInline(content.slice(segStart), ctx));
  }
  return nodes;
}
