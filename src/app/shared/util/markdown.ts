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
export type MdNodeType =
  | 'text'
  | 'mention'
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
}

type ContainerType = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';

// Mirrors the backend MentionParser / mention-tokens token charset (ASP.NET Identity's default
// allowed username characters) so a chip here matches what the server actually parsed.
const MENTION_RE = /^@([A-Za-z0-9\-._+]+)/;

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

function parseInline(s: string, known: Set<string>): MdNode[] {
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

    // Mention — chip only for @everyone / @here / a known username; otherwise fall through to text.
    if (c === '@') {
      const m = MENTION_RE.exec(s.slice(i));
      if (m) {
        const username = m[1].toLowerCase();
        if (username === 'everyone' || username === 'here' || known.has(username)) {
          flush(i);
          out.push({ type: 'mention', text: m[0] });
          i += m[0].length;
          textStart = i;
          continue;
        }
      }
    }

    // Delimited span (bold/italic/underline/strike/spoiler) — recurse into the inner content.
    const d = matchDelim(s, i);
    if (d) {
      const innerStart = i + d.open.length;
      const close = findClose(s, innerStart, d.open);
      if (close > innerStart) {
        flush(i);
        out.push({ type: d.type, children: parseInline(s.slice(innerStart, close), known) });
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
export function parseMarkdown(content: string, known: Set<string>): MdNode[] {
  const nodes: MdNode[] = [];
  let i = 0;
  let segStart = 0;

  while (i < content.length) {
    if (content.startsWith('```', i)) {
      const close = content.indexOf('```', i + 3);
      if (close !== -1) {
        if (i > segStart) nodes.push(...parseInline(content.slice(segStart, i), known));

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
    nodes.push(...parseInline(content.slice(segStart), known));
  }
  return nodes;
}
