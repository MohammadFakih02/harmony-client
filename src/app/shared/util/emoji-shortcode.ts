import { EMOJI_CATEGORIES, EmojiItem } from './emoji-data';

export interface EmojiTrigger {
  start: number; // index of ':' in the text
  query: string; // text typed after ':' (raw case)
}

// Shortcode tokens: what can sit between the colons (`:clap:`) or after the trigger colon.
// Letters/digits/underscore/plus/minus — anything else (")", ".", another ":") ends the token,
// so clock times ("10:30") and smileys (":-)") never read as shortcodes.
const TOKEN = /^[a-z0-9_+-]+$/i;

/**
 * Scans backwards from the caret for an unterminated `:token` — one whose ':' starts the string
 * or follows whitespace, with a token of 2+ shortcode chars and no whitespace inside. Returns
 * null when the caret isn't inside such a token. Mirrors `detectMentionTrigger` ('@').
 */
export function detectEmojiTrigger(value: string, caret: number): EmojiTrigger | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const word = value.slice(start, caret);
  if (!word.startsWith(':')) return null;
  const query = word.slice(1);
  if (query.length < 2 || !TOKEN.test(query)) return null;
  return { start, query };
}

/**
 * Replaces the `:query` at `trigger` with the emoji character and returns the new text + the
 * caret position after it. Mirrors `applyMention` (no trailing space — shortcodes chain).
 */
export function applyEmoji(
  value: string,
  trigger: EmojiTrigger,
  char: string,
): { text: string; caret: number } {
  const before = value.slice(0, trigger.start);
  const after = value.slice(trigger.start + 1 + trigger.query.length);
  return { text: before + char + after, caret: before.length + char.length };
}

// name → char ("thumbs up" matches :thumbs_up: and :thumbsup:), then keywords — first
// definition wins on keyword collisions ("happy" belongs to 😀 before 😃).
let exactIndex: Map<string, string> | null = null;

function buildExactIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const claim = (token: string, char: string) => {
    if (!index.has(token)) index.set(token, char);
  };
  for (const category of EMOJI_CATEGORIES) {
    for (const e of category.emojis) {
      const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      claim(slug, e.char);
      claim(slug.replace(/_/g, ''), e.char);
    }
  }
  for (const category of EMOJI_CATEGORIES) {
    for (const e of category.emojis) {
      for (const k of e.keywords) claim(k.toLowerCase(), e.char);
    }
  }
  return index;
}

/** The emoji for an exact `:token:` shortcode (name slug or keyword), or null. */
export function emojiForShortcode(token: string): string | null {
  exactIndex ??= buildExactIndex();
  return exactIndex.get(token.toLowerCase()) ?? null;
}

/**
 * When the text just before the caret is a complete `:token:` (the user typed the closing
 * colon), converts it to its emoji. Returns the new text + caret, or null when there's nothing
 * to convert. Call on every input — it only acts when a closing ':' was just completed.
 */
export function convertCompletedShortcode(
  value: string,
  caret: number,
): { text: string; caret: number } | null {
  if (value[caret - 1] !== ':') return null;
  const match = /:([a-z0-9_+-]{2,}):$/i.exec(value.slice(0, caret));
  if (!match) return null;
  const start = caret - match[0].length;
  if (start > 0 && !/\s/.test(value[start - 1])) return null; // mid-word, e.g. "10:30:45"
  const char = emojiForShortcode(match[1]);
  if (!char) return null;
  const before = value.slice(0, start);
  return { text: before + char + value.slice(caret), caret: before.length + char.length };
}

export type { EmojiItem };
