import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, searchEmojis } from './emoji-data';

describe('emoji-data', () => {
  it('has non-empty categories with unique ids', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(0);
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cat of EMOJI_CATEGORIES) {
      expect(cat.emojis.length).toBeGreaterThan(0);
      expect(cat.icon).toBeTruthy();
      expect(cat.name).toBeTruthy();
    }
  });

  it('has no duplicate emoji characters across all categories', () => {
    const chars = EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((e) => e.char));
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('every emoji has a name and at least one keyword', () => {
    for (const cat of EMOJI_CATEGORIES) {
      for (const e of cat.emojis) {
        expect(e.char).toBeTruthy();
        expect(e.name).toBeTruthy();
        expect(e.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  describe('searchEmojis', () => {
    it('returns [] for an empty or blank query', () => {
      expect(searchEmojis('')).toEqual([]);
      expect(searchEmojis('   ')).toEqual([]);
    });

    it('matches by name', () => {
      const results = searchEmojis('rocket');
      expect(results.some((e) => e.char === '🚀')).toBe(true);
    });

    it('matches by keyword (not just name)', () => {
      const results = searchEmojis('lol');
      expect(results.some((e) => e.char === '😂')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(searchEmojis('FIRE').some((e) => e.char === '🔥')).toBe(true);
    });

    it('respects the result limit', () => {
      // 'a' appears in many names/keywords; the limit caps the result count.
      expect(searchEmojis('a', 5).length).toBeLessThanOrEqual(5);
    });

    it('returns [] when nothing matches', () => {
      expect(searchEmojis('zzzzznotanemoji')).toEqual([]);
    });
  });
});
