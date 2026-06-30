import { MdNode, parseMarkdown } from './markdown';

const known = new Set<string>(['alice', 'bob']);
const parse = (s: string): MdNode[] => parseMarkdown(s, known);

// Flatten a tree to a "type:text" string list (depth-first) for compact structural assertions.
const flatten = (nodes: MdNode[]): string[] =>
  nodes.flatMap((n) =>
    n.children ? [n.type, ...flatten(n.children)] : [`${n.type}:${n.text ?? ''}`],
  );

describe('parseMarkdown', () => {
  it('returns a single text node for plain content', () => {
    expect(parse('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('parses **bold**', () => {
    expect(parse('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ]);
  });

  it('parses *italic* and _italic_', () => {
    expect(flatten(parse('*x*'))).toEqual(['italic', 'text:x']);
    expect(flatten(parse('_y_'))).toEqual(['italic', 'text:y']);
  });

  it('parses __underline__ (not italic)', () => {
    expect(flatten(parse('__u__'))).toEqual(['underline', 'text:u']);
  });

  it('parses ~~strike~~ and ||spoiler||', () => {
    expect(flatten(parse('~~s~~'))).toEqual(['strike', 'text:s']);
    expect(flatten(parse('||sp||'))).toEqual(['spoiler', 'text:sp']);
  });

  it('nests formatting (bold > italic)', () => {
    expect(flatten(parse('**a *b* c**'))).toEqual([
      'bold',
      'text:a ',
      'italic',
      'text:b',
      'text: c',
    ]);
  });

  it('treats inline code as literal — no markdown or mentions inside', () => {
    expect(parse('`**not bold** @alice`')).toEqual([
      { type: 'code', text: '**not bold** @alice' },
    ]);
  });

  it('parses a fenced code block with a language', () => {
    expect(parse('```js\nconst x = 1;\n```')).toEqual([
      { type: 'codeblock', text: 'const x = 1;', lang: 'js' },
    ]);
  });

  it('parses a code block with no language', () => {
    expect(parse('```\nplain\n```')).toEqual([{ type: 'codeblock', text: 'plain', lang: null }]);
  });

  it('parses a single-line triple-backtick block', () => {
    expect(parse('```code```')).toEqual([{ type: 'codeblock', text: 'code', lang: null }]);
  });

  it('keeps text around a code block', () => {
    expect(flatten(parse('before ```x``` after'))).toEqual([
      'text:before ',
      'codeblock:x',
      'text: after',
    ]);
  });

  it('renders @everyone / @here / known usernames as mention chips', () => {
    expect(flatten(parse('hi @alice'))).toEqual(['text:hi ', 'mention:@alice']);
    expect(flatten(parse('@everyone go'))).toEqual(['mention:@everyone', 'text: go']);
    expect(flatten(parse('@here'))).toEqual(['mention:@here']);
  });

  it('leaves an unknown @username as plain text', () => {
    expect(parse('@stranger')).toEqual([{ type: 'text', text: '@stranger' }]);
  });

  it('parses a mention inside bold', () => {
    expect(flatten(parse('**@bob**'))).toEqual(['bold', 'mention:@bob']);
  });

  it('treats an unmatched delimiter as literal text', () => {
    expect(parse('a ** b')).toEqual([{ type: 'text', text: 'a ** b' }]);
    expect(parse('lone *')).toEqual([{ type: 'text', text: 'lone *' }]);
  });

  it('preserves newlines in text', () => {
    expect(parse('line1\nline2')).toEqual([{ type: 'text', text: 'line1\nline2' }]);
  });

  it('ignores empty inline code (adjacent backticks)', () => {
    // `` is not a code span; it stays literal text.
    expect(parse('a `` b')).toEqual([{ type: 'text', text: 'a `` b' }]);
  });
});
