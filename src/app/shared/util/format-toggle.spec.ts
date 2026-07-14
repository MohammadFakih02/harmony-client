import { describe, expect, it } from 'vitest';
import { toggleWrap } from './format-toggle';

describe('toggleWrap', () => {
  it('wraps a selection and keeps it selected inside the markers', () => {
    const result = toggleWrap('hello world', 6, 11, '**');
    expect(result.text).toBe('hello **world**');
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(13);
  });

  it('round-trips: toggling a wrapped selection unwraps it', () => {
    const wrapped = toggleWrap('hello world', 6, 11, '**');
    const back = toggleWrap(wrapped.text, wrapped.selectionStart, wrapped.selectionEnd, '**');
    expect(back.text).toBe('hello world');
    expect(back.selectionStart).toBe(6);
    expect(back.selectionEnd).toBe(11);
  });

  it('unwraps when the markers are included in the selection', () => {
    const result = toggleWrap('a **bold** z', 2, 10, '**');
    expect(result.text).toBe('a bold z');
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(6);
  });

  it('inserts a pair around an empty selection and parks the caret between', () => {
    const result = toggleWrap('hi ', 3, 3, '*');
    expect(result.text).toBe('hi **');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(4);
  });

  it('supports asymmetric markers (code fences)', () => {
    const result = toggleWrap('const x = 1;', 0, 12, '```\n', '\n```');
    expect(result.text).toBe('```\nconst x = 1;\n```');
    const back = toggleWrap(result.text, result.selectionStart, result.selectionEnd, '```\n', '\n```');
    expect(back.text).toBe('const x = 1;');
  });
});
