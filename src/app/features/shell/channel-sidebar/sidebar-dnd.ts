/**
 * Pure drop-target resolution for the channel-sidebar drag-and-drop.
 *
 * The sidebar renders ONE CDK drop list with sorting disabled: nothing shifts while a drag is in
 * flight, so live `getBoundingClientRect` reads are trustworthy for the whole gesture. On every
 * drag move the component collects the visible rows (top-level channel rows, category headers,
 * in-category rows — or, for a category drag, whole blocks and bare rows), and this module turns
 * "pointer y over those rows" into a semantic drop target plus the indicator to render.
 *
 * Row keys (channel drag):        `top:{channelId}` | `head:{catId}` | `cat:{catId}:{channelId}`
 * Row keys (category drag):       `top:{channelId}` | `block:{catId}`
 * Indicator keys reuse the row keys, with `block:{catId}` standing in for a whole category block.
 *
 * Band model: the rows partition the whole vertical axis — each row's band extends halfway into
 * the gaps around it (first band reaches up to -∞), so there are no dead zones between rows or in
 * block padding. Within a band, the row's midline splits "insert above" from "insert below".
 * Below the last row a small slop still belongs to that row; past it the drop means "append at
 * top level" (`'end'`) — which is also what makes "bare channel AFTER the last category" reachable.
 */

export interface BandRow {
  key: string;
  top: number;
  bottom: number;
}

export type BandHit = { key: string; edge: 'above' | 'below' } | 'end';

export type DropTarget =
  | { scope: 'top'; before: string | null } // top-level insert before entry id (null = append)
  | { scope: 'cat'; catId: string; before: string | null }; // into category, before channel id (null = append)

export type DropIndicator =
  | { kind: 'line'; key: string; edge: 'above' | 'below' }
  | { kind: 'into'; catId: string }; // whole-block highlight (append into a collapsed/empty category)

export interface DropResolution {
  target: DropTarget;
  indicator: DropIndicator | null;
}

/** Structural subset of the store's SidebarEntry — lets specs build fixtures without full models. */
export type SidebarEntryLike =
  | {
      kind: 'category';
      category: { id: string; collapsed: boolean; channels: ReadonlyArray<{ id: string }> };
    }
  | { kind: 'channel'; channel: { id: string } };

export interface SidebarView {
  top: ReadonlyArray<{ kind: 'category' | 'channel'; id: string }>;
  cats: ReadonlyMap<string, { channelIds: readonly string[]; collapsed: boolean }>;
}

export function buildSidebarView(entries: ReadonlyArray<SidebarEntryLike>): SidebarView {
  const top: { kind: 'category' | 'channel'; id: string }[] = [];
  const cats = new Map<string, { channelIds: string[]; collapsed: boolean }>();
  for (const e of entries) {
    if (e.kind === 'category') {
      top.push({ kind: 'category', id: e.category.id });
      cats.set(e.category.id, {
        channelIds: e.category.channels.map((c) => c.id),
        collapsed: e.category.collapsed,
      });
    } else {
      top.push({ kind: 'channel', id: e.channel.id });
    }
  }
  return { top, cats };
}

/**
 * Which row band the pointer is in, and which half of that row. Rows must be in visual (top→down)
 * order — document order delivers that, since the list never reflows mid-drag. `'end'` = below
 * everything (plus slop) → append at top level. `null` = no rows at all.
 */
export function pickBand(
  rows: readonly BandRow[],
  y: number,
  bottomSlop: number,
): BandHit | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (y > last.bottom + bottomSlop) return 'end';
  let band = rows[0]; // first band reaches up to -∞ (dragging above the list = before the first row)
  for (let i = 1; i < rows.length; i++) {
    const boundary = (rows[i - 1].bottom + rows[i].top) / 2;
    if (y >= boundary) band = rows[i];
    else break;
  }
  return { key: band.key, edge: y < (band.top + band.bottom) / 2 ? 'above' : 'below' };
}

/** `ids` with `moved` re-inserted before `before` (null/missing anchor = append). Anchoring to
 *  yourself means "stay put" — the caller's no-op detection then suppresses the drop. */
export function insertBefore(
  ids: readonly string[],
  moved: string,
  before: string | null,
): string[] {
  if (before === moved) return [...ids];
  const rest = ids.filter((id) => id !== moved);
  if (before !== null) {
    const i = rest.indexOf(before);
    if (i !== -1) {
      rest.splice(i, 0, moved);
      return rest;
    }
  }
  rest.push(moved);
  return rest;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Resolve a channel drag. Row semantics:
 *  - `top:{id}`      upper half → top-level before that entry; lower half → before the next entry.
 *  - `head:{cat}`    upper half → top-level ABOVE the block; lower half → INTO the category
 *                    (before its first channel; append + block highlight when collapsed/empty).
 *  - `cat:{c}:{id}`  upper/lower half → into that category before that row / the next row.
 *  - `'end'`         → top-level append.
 * Returns null when the drop would change nothing (indicator hidden, commit skipped).
 */
export function resolveChannelDrop(
  hit: BandHit | null,
  view: SidebarView,
  draggedId: string,
): DropResolution | null {
  if (!hit) return null;
  let target: DropTarget;
  let indicator: DropIndicator | null;

  if (hit === 'end') {
    target = { scope: 'top', before: null };
    indicator = lineAfterLastEntry(view);
  } else if (hit.key.startsWith('top:')) {
    const id = hit.key.slice(4);
    target = { scope: 'top', before: hit.edge === 'above' ? id : nextTopId(view, id) };
    indicator = { kind: 'line', key: hit.key, edge: hit.edge };
  } else if (hit.key.startsWith('head:')) {
    const catId = hit.key.slice(5);
    const cat = view.cats.get(catId);
    if (!cat) return null;
    if (hit.edge === 'above') {
      target = { scope: 'top', before: catId };
      indicator = { kind: 'line', key: `block:${catId}`, edge: 'above' };
    } else if (cat.collapsed || cat.channelIds.length === 0) {
      target = { scope: 'cat', catId, before: null };
      indicator = { kind: 'into', catId };
    } else {
      const first = cat.channelIds[0];
      target = { scope: 'cat', catId, before: first };
      indicator = { kind: 'line', key: `cat:${catId}:${first}`, edge: 'above' };
    }
  } else if (hit.key.startsWith('cat:')) {
    const rest = hit.key.slice(4);
    const sep = rest.indexOf(':');
    const catId = rest.slice(0, sep);
    const channelId = rest.slice(sep + 1);
    const cat = view.cats.get(catId);
    if (!cat) return null;
    target = {
      scope: 'cat',
      catId,
      before: hit.edge === 'above' ? channelId : nextInCat(cat.channelIds, channelId),
    };
    indicator = { kind: 'line', key: hit.key, edge: hit.edge };
  } else {
    return null;
  }

  return isChannelNoop(target, view, draggedId) ? null : { target, indicator };
}

/**
 * Resolve a category-block drag: only top-level gaps are valid (a category can never nest).
 * Rows here are whole entries (`block:{catId}` / `top:{channelId}`); upper/lower half of the
 * entry → before it / before the next entry. Self-adjacent drops resolve to null.
 */
export function resolveCategoryDrop(
  hit: BandHit | null,
  view: SidebarView,
  draggedCatId: string,
): DropResolution | null {
  if (!hit) return null;
  let before: string | null;
  let indicator: DropIndicator | null;

  if (hit === 'end') {
    before = null;
    indicator = lineAfterLastEntry(view);
  } else {
    const entryId = hit.key.startsWith('block:')
      ? hit.key.slice(6)
      : hit.key.startsWith('top:')
        ? hit.key.slice(4)
        : null;
    if (entryId === null) return null;
    before = hit.edge === 'above' ? entryId : nextTopId(view, entryId);
    indicator = { kind: 'line', key: hit.key, edge: hit.edge };
  }

  const topIds = view.top.map((e) => e.id);
  if (sameOrder(insertBefore(topIds, draggedCatId, before), topIds)) return null;
  return { target: { scope: 'top', before }, indicator };
}

// --- internals ---------------------------------------------------------------------------------

function nextTopId(view: SidebarView, id: string): string | null {
  const i = view.top.findIndex((e) => e.id === id);
  return i >= 0 && i + 1 < view.top.length ? view.top[i + 1].id : null;
}

function nextInCat(channelIds: readonly string[], id: string): string | null {
  const i = channelIds.indexOf(id);
  return i >= 0 && i + 1 < channelIds.length ? channelIds[i + 1] : null;
}

function lineAfterLastEntry(view: SidebarView): DropIndicator | null {
  const last = view.top[view.top.length - 1];
  if (!last) return null;
  return {
    kind: 'line',
    key: last.kind === 'category' ? `block:${last.id}` : `top:${last.id}`,
    edge: 'below',
  };
}

function isChannelNoop(target: DropTarget, view: SidebarView, draggedId: string): boolean {
  let currentCat: string | null = null;
  for (const [id, cat] of view.cats) {
    if (cat.channelIds.includes(draggedId)) {
      currentCat = id;
      break;
    }
  }
  if (target.scope === 'top') {
    if (currentCat !== null) return false; // leaving a category always changes something
    const topIds = view.top.map((e) => e.id);
    return sameOrder(insertBefore(topIds, draggedId, target.before), topIds);
  }
  if (currentCat !== target.catId) return false; // joining/switching category always changes something
  const ids = view.cats.get(target.catId)?.channelIds ?? [];
  return sameOrder(insertBefore(ids, draggedId, target.before), ids);
}
