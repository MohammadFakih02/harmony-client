import { describe, it, expect } from 'vitest';
import {
  BandRow,
  buildSidebarView,
  insertBefore,
  pickBand,
  resolveCategoryDrop,
  resolveChannelDrop,
  sameOrder,
} from './sidebar-dnd';

/** The screenshot layout: bare #general above a "voice" category holding 🔊chatting. */
const entries = [
  { kind: 'channel' as const, channel: { id: 'general' } },
  {
    kind: 'category' as const,
    category: { id: 'voice', collapsed: false, channels: [{ id: 'chatting' }] },
  },
];
const view = buildSidebarView(entries);

/** Rows as the DOM would report them: general 0–32, header 40–64, chatting row 64–96. */
const rows: BandRow[] = [
  { key: 'top:general', top: 0, bottom: 32 },
  { key: 'head:voice', top: 40, bottom: 64 },
  { key: 'cat:voice:chatting', top: 64, bottom: 96 },
];

describe('pickBand', () => {
  it('maps a pointer above the first row to its upper half', () => {
    expect(pickBand(rows, -20, 12)).toEqual({ key: 'top:general', edge: 'above' });
  });

  it('splits a row at its midline', () => {
    expect(pickBand(rows, 10, 12)).toEqual({ key: 'top:general', edge: 'above' });
    expect(pickBand(rows, 25, 12)).toEqual({ key: 'top:general', edge: 'below' });
  });

  it('assigns the gap between rows to the nearer one (midpoint boundary)', () => {
    expect(pickBand(rows, 35, 12)).toEqual({ key: 'top:general', edge: 'below' }); // gap 32–40
    expect(pickBand(rows, 37, 12)).toEqual({ key: 'head:voice', edge: 'above' });
  });

  it('keeps a short distance below the last row targeting it, then falls to end', () => {
    expect(pickBand(rows, 104, 12)).toEqual({ key: 'cat:voice:chatting', edge: 'below' });
    expect(pickBand(rows, 120, 12)).toBe('end');
  });

  it('returns null with no rows', () => {
    expect(pickBand([], 50, 12)).toBeNull();
  });
});

describe('resolveChannelDrop', () => {
  it('routes a channel dropped on the lower half of a category header INTO the category (the from-above bug)', () => {
    const res = resolveChannelDrop({ key: 'head:voice', edge: 'below' }, view, 'general');
    expect(res?.target).toEqual({ scope: 'cat', catId: 'voice', before: 'chatting' });
    expect(res?.indicator).toEqual({ kind: 'line', key: 'cat:voice:chatting', edge: 'above' });
  });

  it('routes the upper half of a header to "top level, above the block"', () => {
    // general already sits directly above voice, so for IT this is a no-op…
    expect(resolveChannelDrop({ key: 'head:voice', edge: 'above' }, view, 'general')).toBeNull();
    // …but for a channel inside the category it is a real ungroup-above-the-block.
    const res = resolveChannelDrop({ key: 'head:voice', edge: 'above' }, view, 'chatting');
    expect(res?.target).toEqual({ scope: 'top', before: 'voice' });
    expect(res?.indicator).toEqual({ kind: 'line', key: 'block:voice', edge: 'above' });
  });

  it('appends into a collapsed category from its header and highlights the block', () => {
    const collapsed = buildSidebarView([
      { kind: 'channel', channel: { id: 'general' } },
      { kind: 'category', category: { id: 'voice', collapsed: true, channels: [{ id: 'chatting' }] } },
    ]);
    const res = resolveChannelDrop({ key: 'head:voice', edge: 'below' }, collapsed, 'general');
    expect(res?.target).toEqual({ scope: 'cat', catId: 'voice', before: null });
    expect(res?.indicator).toEqual({ kind: 'into', catId: 'voice' });
  });

  it('appends into an expanded EMPTY category from its header', () => {
    const empty = buildSidebarView([
      { kind: 'channel', channel: { id: 'general' } },
      { kind: 'category', category: { id: 'voice', collapsed: false, channels: [] } },
    ]);
    const res = resolveChannelDrop({ key: 'head:voice', edge: 'below' }, empty, 'general');
    expect(res?.target).toEqual({ scope: 'cat', catId: 'voice', before: null });
    expect(res?.indicator).toEqual({ kind: 'into', catId: 'voice' });
  });

  it('maps in-category rows to before/after positions', () => {
    const above = resolveChannelDrop({ key: 'cat:voice:chatting', edge: 'above' }, view, 'general');
    expect(above?.target).toEqual({ scope: 'cat', catId: 'voice', before: 'chatting' });
    const below = resolveChannelDrop({ key: 'cat:voice:chatting', edge: 'below' }, view, 'general');
    expect(below?.target).toEqual({ scope: 'cat', catId: 'voice', before: null }); // last row → append
  });

  it('maps end-of-list to a top-level append with a line below the last block', () => {
    const res = resolveChannelDrop('end', view, 'general');
    expect(res?.target).toEqual({ scope: 'top', before: null });
    expect(res?.indicator).toEqual({ kind: 'line', key: 'block:voice', edge: 'below' });
  });

  it('suppresses drops that would change nothing', () => {
    // own slot, both halves
    expect(resolveChannelDrop({ key: 'top:general', edge: 'above' }, view, 'general')).toBeNull();
    expect(resolveChannelDrop({ key: 'top:general', edge: 'below' }, view, 'general')).toBeNull();
    // a category channel hovering its own row
    expect(
      resolveChannelDrop({ key: 'cat:voice:chatting', edge: 'above' }, view, 'chatting'),
    ).toBeNull();
  });

  it('never treats a category switch as a no-op', () => {
    const two = buildSidebarView([
      { kind: 'category', category: { id: 'a', collapsed: false, channels: [{ id: 'x' }] } },
      { kind: 'category', category: { id: 'b', collapsed: false, channels: [{ id: 'y' }] } },
    ]);
    const res = resolveChannelDrop({ key: 'cat:b:y', edge: 'above' }, two, 'x');
    expect(res?.target).toEqual({ scope: 'cat', catId: 'b', before: 'y' });
  });

  it('returns null for unknown keys and null hits', () => {
    expect(resolveChannelDrop(null, view, 'general')).toBeNull();
    expect(resolveChannelDrop({ key: 'bogus', edge: 'above' }, view, 'general')).toBeNull();
  });
});

describe('resolveCategoryDrop', () => {
  const three = buildSidebarView([
    { kind: 'category', category: { id: 'a', collapsed: false, channels: [{ id: 'x' }] } },
    { kind: 'channel', channel: { id: 'mid' } },
    { kind: 'category', category: { id: 'b', collapsed: false, channels: [] } },
  ]);

  it('reorders a category before/after top-level entries', () => {
    const res = resolveCategoryDrop({ key: 'top:mid', edge: 'above' }, three, 'b');
    expect(res?.target).toEqual({ scope: 'top', before: 'mid' });
    const after = resolveCategoryDrop({ key: 'block:b', edge: 'below' }, three, 'a');
    expect(after?.target).toEqual({ scope: 'top', before: null });
  });

  it('suppresses self and adjacent no-op drops', () => {
    expect(resolveCategoryDrop({ key: 'block:a', edge: 'above' }, three, 'a')).toBeNull();
    expect(resolveCategoryDrop({ key: 'block:a', edge: 'below' }, three, 'a')).toBeNull(); // before mid = unchanged
    expect(resolveCategoryDrop({ key: 'top:mid', edge: 'above' }, three, 'a')).toBeNull();
  });

  it('maps end-of-list to append', () => {
    const res = resolveCategoryDrop('end', three, 'a');
    expect(res?.target).toEqual({ scope: 'top', before: null });
    expect(res?.indicator).toEqual({ kind: 'line', key: 'block:b', edge: 'below' });
  });
});

describe('insertBefore / sameOrder', () => {
  it('inserts before the anchor, treating a self-anchor as unchanged', () => {
    expect(insertBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(insertBefore(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
  });

  it('appends on a null or missing anchor', () => {
    expect(insertBefore(['a', 'b'], 'a', null)).toEqual(['b', 'a']);
    expect(insertBefore(['a', 'b'], 'a', 'ghost')).toEqual(['b', 'a']);
  });

  it('inserts an id not present in the list (cross-scope move)', () => {
    expect(insertBefore(['a', 'b'], 'z', 'b')).toEqual(['a', 'z', 'b']);
  });

  it('compares order strictly', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });
});
