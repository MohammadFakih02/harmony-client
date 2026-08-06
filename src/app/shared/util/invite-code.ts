/**
 * Pulls an invite code out of whatever a user pastes — a bare code, or a full link such as
 * `https://…/invite/ABC` or the API form `…/invites/ABC/join`. Falls back to the last path
 * segment so an unexpected URL shape still yields something usable.
 */
export function extractInviteCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/invites?\/([^/\s]+)/i);
  if (match) return match[1];
  return trimmed.split('/').filter(Boolean).pop() ?? '';
}
