export interface MentionToken {
  text: string;
  isMention: boolean;
}

// Mirrors the backend's MentionParser token regex exactly (ASP.NET Identity's default allowed
// username characters) so what renders as a chip matches what the server actually parsed.
const TOKEN_REGEX = /@([A-Za-z0-9\-._+]+)/g;

/**
 * Splits message content into plain-text and mention segments. A `@username` segment is
 * chip-eligible only if its lowercased username is in `knownUsernamesLower` — `@everyone`/
 * `@here` are always chip-eligible. This re-parses content client-side rather than trusting
 * server-assigned mention-id positions (the backend doesn't expose per-character offsets).
 */
export function tokenizeMentions(content: string, knownUsernamesLower: Set<string>): MentionToken[] {
  const tokens: MentionToken[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(TOKEN_REGEX)) {
    const index = match.index;
    const fullMatch = match[0];
    const username = match[1].toLowerCase();

    if (index > lastIndex) {
      tokens.push({ text: content.slice(lastIndex, index), isMention: false });
    }

    const isMention =
      username === 'everyone' || username === 'here' || knownUsernamesLower.has(username);
    tokens.push({ text: fullMatch, isMention });

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    tokens.push({ text: content.slice(lastIndex), isMention: false });
  }

  return tokens;
}
