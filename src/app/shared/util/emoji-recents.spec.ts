import { beforeEach, describe, expect, it } from 'vitest';
import { getRecents, pushRecent } from './emoji-recents';

describe('emoji-recents', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] when nothing is stored', () => {
    expect(getRecents()).toEqual([]);
  });

  it('persists a pushed emoji and reads it back', () => {
    pushRecent('🔥');
    expect(getRecents()).toEqual(['🔥']);
  });

  it('moves a re-used emoji to the front without duplicating', () => {
    pushRecent('🔥');
    pushRecent('😂');
    pushRecent('🔥');
    expect(getRecents()).toEqual(['🔥', '😂']);
  });

  it('caps the list at 24 entries, keeping the most recent', () => {
    for (let i = 0; i < 30; i++) pushRecent(`e${i}`);
    const recents = getRecents();
    expect(recents.length).toBe(24);
    expect(recents[0]).toBe('e29'); // most recent first
    expect(recents).not.toContain('e0'); // oldest evicted
  });

  it('ignores a malformed stored value (fail-soft to [])', () => {
    localStorage.setItem('harmony-emoji-recents', '{not json');
    expect(getRecents()).toEqual([]);
  });
});
