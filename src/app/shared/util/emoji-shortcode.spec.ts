import { describe, expect, it } from 'vitest';
import {
  applyEmoji,
  convertCompletedShortcode,
  detectEmojiTrigger,
  emojiForShortcode,
} from './emoji-shortcode';

describe('detectEmojiTrigger', () => {
  it('detects an unterminated :token at the caret', () => {
    expect(detectEmojiTrigger('hello :cl', 9)).toEqual({ start: 6, query: 'cl' });
  });

  it('requires at least two query characters', () => {
    expect(detectEmojiTrigger(':c', 2)).toBeNull();
    expect(detectEmojiTrigger(':', 1)).toBeNull();
  });

  it('ignores colons inside a word (clock times)', () => {
    expect(detectEmojiTrigger('meet at 10:30', 13)).toBeNull();
  });

  it('ignores tokens with non-shortcode characters (smileys)', () => {
    expect(detectEmojiTrigger(':-))', 4)).toBeNull();
  });

  it('returns null without a colon trigger', () => {
    expect(detectEmojiTrigger('hello world', 11)).toBeNull();
  });
});

describe('applyEmoji', () => {
  it('replaces the trigger with the emoji and parks the caret after it', () => {
    const result = applyEmoji('hi :cla there', { start: 3, query: 'cla' }, '👏');
    expect(result.text).toBe('hi 👏 there');
    expect(result.caret).toBe(3 + '👏'.length);
  });
});

describe('emojiForShortcode', () => {
  it('resolves name slugs, slugs without underscores, and keywords', () => {
    expect(emojiForShortcode('thinking_face')).toBe('🤔');
    expect(emojiForShortcode('thinkingface')).toBe('🤔');
    expect(emojiForShortcode('clap')).toBe('👏');
    expect(emojiForShortcode('joy')).toBe('😂');
  });

  it('is case-insensitive and null for unknown tokens', () => {
    expect(emojiForShortcode('CLAP')).toBe('👏');
    expect(emojiForShortcode('definitely_not_an_emoji')).toBeNull();
  });
});

describe('convertCompletedShortcode', () => {
  it('converts a just-closed exact shortcode in place', () => {
    const result = convertCompletedShortcode('nice :clap:', 11);
    expect(result?.text).toBe('nice 👏');
    expect(result?.caret).toBe(5 + '👏'.length);
  });

  it('keeps text after the caret intact', () => {
    const result = convertCompletedShortcode(':joy: ok', 5);
    expect(result?.text).toBe('😂 ok');
  });

  it('does not convert unknown tokens, mid-word colons, or non-colon input', () => {
    expect(convertCompletedShortcode('so :zzznope:', 12)).toBeNull();
    expect(convertCompletedShortcode('10:30:45:', 9)).toBeNull();
    expect(convertCompletedShortcode('plain text', 10)).toBeNull();
  });
});
