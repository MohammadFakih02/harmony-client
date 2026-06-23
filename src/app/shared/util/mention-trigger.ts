export interface MentionTrigger {
  start: number; // index of '@' in the text
  query: string; // text typed after '@' (raw case)
}

/**
 * Scans backwards from the caret for an unterminated `@token` — one that starts at the
 * string start or right after whitespace and has no whitespace inside it. Returns null when
 * the caret isn't inside such a token. Shared by the composer and the inline message editor.
 */
export function detectMentionTrigger(value: string, caret: number): MentionTrigger | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const word = value.slice(start, caret);
  if (!word.startsWith('@')) return null;
  return { start, query: word.slice(1) };
}

/**
 * Replaces the `@query` at `trigger` with `@username ` and returns the new text + the caret
 * position to place after it. Shared insertion logic for the composer and inline editor.
 */
export function applyMention(
  value: string,
  trigger: MentionTrigger,
  username: string,
): { text: string; caret: number } {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.start + 1 + trigger.query.length);
  const insertion = `@${username} `;
  return { text: before + insertion + after, caret: before.length + insertion.length };
}
