/**
 * One moderation-history entry for a guild. Mirrors the backend `AuditLogEntryResponse`
 * (§5.23). Snowflake ids stay strings (the bigInt interceptor); `createdAt` is coerced to a
 * number. `changes` is the raw jsonb string as stored — parsed per `actionType` at render.
 */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorUsername: string | null;
  actorAvatarKey: string | null;
  actionType: string;
  targetId: string | null;
  changes: string | null;
  reason: string | null;
  createdAt: number;
}

/** Query options for the audit-log list. `before` is a keyset cursor on the entry snowflake. */
export interface AuditLogQuery {
  before?: string;
  action?: string;
}

/** Presentational metadata (icon + human phrase) for each audit action type. */
export const AUDIT_ACTION_META: Record<string, { icon: string; verb: string }> = {
  member_kick: { icon: 'fa-user-slash', verb: 'kicked a member' },
  member_ban: { icon: 'fa-gavel', verb: 'banned a member' },
  member_unban: { icon: 'fa-user-check', verb: 'unbanned a member' },
  member_timeout: { icon: 'fa-clock', verb: 'timed out a member' },
  member_role_update: { icon: 'fa-user-tag', verb: 'updated a member’s roles' },
  member_nickname_update: { icon: 'fa-signature', verb: 'changed a member’s nickname' },
  invite_create: { icon: 'fa-link', verb: 'created an invite' },
  invite_delete: { icon: 'fa-link-slash', verb: 'deleted an invite' },
  role_create: { icon: 'fa-plus', verb: 'created a role' },
  role_update: { icon: 'fa-pen', verb: 'updated a role' },
  role_delete: { icon: 'fa-trash', verb: 'deleted a role' },
  channel_create: { icon: 'fa-plus', verb: 'created a channel' },
  channel_update: { icon: 'fa-pen', verb: 'updated a channel' },
  channel_delete: { icon: 'fa-trash', verb: 'deleted a channel' },
  message_delete: { icon: 'fa-trash', verb: 'deleted a message' },
  message_pin: { icon: 'fa-thumbtack', verb: 'pinned a message' },
  message_unpin: { icon: 'fa-thumbtack', verb: 'unpinned a message' },
};

/** Icon + phrase for an action type, falling back to a generic entry for unknown types. */
export function auditActionMeta(actionType: string): { icon: string; verb: string } {
  return AUDIT_ACTION_META[actionType] ?? { icon: 'fa-circle-info', verb: actionType };
}
