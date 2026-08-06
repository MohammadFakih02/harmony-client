import { describe, it, expect } from 'vitest';
import {
  parseSearchQuery,
  serializeSearchQuery,
  activeFragment,
  parseDateValue,
} from './search-query';

describe('parseSearchQuery', () => {
  it('returns free text with no tokens for a plain query', () => {
    expect(parseSearchQuery('hello world')).toEqual({ text: 'hello world', tokens: [] });
  });

  it('extracts a recognised operator and strips it from the text', () => {
    expect(parseSearchQuery('from:alice deploy')).toEqual({
      text: 'deploy',
      tokens: [{ op: 'from', value: 'alice' }],
    });
  });

  it('collects multiple operators mixed with free text', () => {
    const parsed = parseSearchQuery('bug in:general from:bob has:link');
    expect(parsed.text).toBe('bug');
    expect(parsed.tokens).toEqual([
      { op: 'in', value: 'general' },
      { op: 'from', value: 'bob' },
      { op: 'has', value: 'link' },
    ]);
  });

  it('honours a double-quoted value that contains spaces', () => {
    expect(parseSearchQuery('from:"Big Bird" foo')).toEqual({
      text: 'foo',
      tokens: [{ op: 'from', value: 'Big Bird' }],
    });
  });

  it('keeps an unknown operator as free text', () => {
    expect(parseSearchQuery('foo:bar baz')).toEqual({ text: 'foo:bar baz', tokens: [] });
  });

  it('keeps a URL (colon-bearing word) as free text', () => {
    const parsed = parseSearchQuery('see https://example.com/x now');
    expect(parsed.tokens).toEqual([]);
    expect(parsed.text).toBe('see https://example.com/x now');
  });

  it('drops an operator with an empty value (half-typed)', () => {
    expect(parseSearchQuery('from: hello')).toEqual({ text: 'hello', tokens: [] });
  });

  it('is case-insensitive on the operator name and lower-cases it', () => {
    expect(parseSearchQuery('FROM:alice')).toEqual({
      text: '',
      tokens: [{ op: 'from', value: 'alice' }],
    });
  });
});

describe('serializeSearchQuery', () => {
  it('places operators before the free text', () => {
    expect(
      serializeSearchQuery({ text: 'deploy', tokens: [{ op: 'from', value: 'alice' }] }),
    ).toBe('from:alice deploy');
  });

  it('quotes a value containing whitespace', () => {
    expect(
      serializeSearchQuery({ text: '', tokens: [{ op: 'from', value: 'Big Bird' }] }),
    ).toBe('from:"Big Bird"');
  });

  it('omits empty free text', () => {
    expect(serializeSearchQuery({ text: '', tokens: [{ op: 'has', value: 'link' }] })).toBe(
      'has:link',
    );
  });

  it('round-trips a mixed query through parse', () => {
    const raw = 'in:general from:"Big Bird" bug report';
    expect(serializeSearchQuery(parseSearchQuery(raw))).toBe(raw);
  });
});

describe('activeFragment', () => {
  it('returns null for an empty string', () => {
    expect(activeFragment('')).toBeNull();
  });

  it('returns null when the trailing char is a space', () => {
    expect(activeFragment('from:alice ')).toBeNull();
  });

  it('offers operator suggestions for a bare prefix', () => {
    expect(activeFragment('fr')).toEqual({ kind: 'operator', partial: 'fr', start: 0 });
  });

  it('does not offer operators for a prefix that matches nothing', () => {
    expect(activeFragment('zzz')).toBeNull();
  });

  it('offers value suggestions once the operator colon is typed', () => {
    expect(activeFragment('from:al')).toEqual({
      kind: 'value',
      op: 'from',
      partial: 'al',
      start: 0,
    });
  });

  it('reports the fragment start for in-place replacement', () => {
    expect(activeFragment('bug in:gen')).toEqual({
      kind: 'value',
      op: 'in',
      partial: 'gen',
      start: 4,
    });
  });

  it('strips the opening quote from the partial', () => {
    expect(activeFragment('from:"Big')).toEqual({
      kind: 'value',
      op: 'from',
      partial: 'big',
      start: 0,
    });
  });

  it('returns null once the value is fully quoted (complete)', () => {
    expect(activeFragment('from:"Big Bird"')).toBeNull();
  });

  it('returns null for an unknown operator', () => {
    expect(activeFragment('foo:bar')).toBeNull();
  });
});

describe('parseDateValue', () => {
  it('parses today into a single-day span', () => {
    const span = parseDateValue('today')!;
    expect(span).not.toBeNull();
    expect(span.end - span.start).toBe(86_400_000);
    expect(span.start).toBe(
      new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime(),
    );
  });

  it('parses yesterday as the day before today', () => {
    const today = parseDateValue('today')!;
    const yesterday = parseDateValue('yesterday')!;
    expect(today.start - yesterday.start).toBe(86_400_000);
  });

  it('parses a full YYYY-MM-DD date as one day', () => {
    const span = parseDateValue('2026-03-15')!;
    expect(span.start).toBe(new Date(2026, 2, 15).getTime());
    expect(span.end).toBe(new Date(2026, 2, 16).getTime());
  });

  it('parses YYYY-MM as a whole month', () => {
    const span = parseDateValue('2026-02')!;
    expect(span.start).toBe(new Date(2026, 1, 1).getTime());
    expect(span.end).toBe(new Date(2026, 2, 1).getTime());
  });

  it('parses YYYY as a whole year', () => {
    const span = parseDateValue('2026')!;
    expect(span.start).toBe(new Date(2026, 0, 1).getTime());
    expect(span.end).toBe(new Date(2027, 0, 1).getTime());
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseDateValue('  TODAY ')).toEqual(parseDateValue('today'));
  });

  it('returns null for an unrecognised value', () => {
    expect(parseDateValue('lastweek')).toBeNull();
    expect(parseDateValue('2026-13-40')).toBeNull();
    expect(parseDateValue('')).toBeNull();
  });
});
