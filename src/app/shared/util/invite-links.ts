/**
 * Pulls invite codes out of message content for inline embeds. Only a *full* http(s) link
 * whose path is `/invite/{code}` (or the API form `/invites/{code}`) triggers an embed — a bare
 * code never does, to avoid turning ordinary words into invite cards. Codes are returned in order
 * of first appearance, deduped.
 *
 * Kept deliberately small and standalone so the later link-preview work (server-side unfurls)
 * can reuse the same "detect a link in message text" seam.
 */
const INVITE_LINK_RE = /https?:\/\/\S+?\/invites?\/([A-Za-z0-9_-]+)/gi;

export function extractInviteCodes(content: string): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(INVITE_LINK_RE)) {
    const code = match[1];
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}
