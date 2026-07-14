/**
 * Selection-preserving markdown wrap/unwrap for the composer's formatting toolbar. Pure — the
 * caller owns the textarea; markers must match the subset `markdown.ts` renders (**, *, __,
 * ~~, ||, `, ``` fences).
 */
export interface FormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Toggles `open`/`close` around [start, end): if the selection is already wrapped (markers just
 * outside it, or included inside it), they're removed; otherwise they're inserted. The selection
 * stays on the same inner text either way, so repeated toggles round-trip. An empty selection
 * inserts the pair and parks the caret between them.
 */
export function toggleWrap(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string = open,
): FormatResult {
  const selected = value.slice(start, end);

  // Markers just outside the selection (the state a previous wrap left behind) → unwrap.
  if (value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
    return {
      text: value.slice(0, start - open.length) + selected + value.slice(end + close.length),
      selectionStart: start - open.length,
      selectionEnd: end - open.length,
    };
  }

  // Markers selected along with the text → unwrap.
  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      text: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  return {
    text: value.slice(0, start) + open + selected + close + value.slice(end),
    selectionStart: start + open.length,
    selectionEnd: start + open.length + selected.length,
  };
}
