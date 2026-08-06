import { ChannelType } from './channel.models';
import { PERMISSION_GROUPS, PermissionGroup } from './permission.constants';

/**
 * One permission's setting inside a channel override: explicitly granted, explicitly denied, or
 * neutral (inherit whatever the target's guild-level roles resolve to). Mirrors the backend's
 * `(perms & ~deny) | allow` — a bit is never in both masks (the API rejects overlap).
 */
export type OverrideTriState = 'allow' | 'neutral' | 'deny';

/** Reads one bit's tri-state out of an override's allow/deny masks. */
export function overrideStateOf(
  allowBits: number,
  denyBits: number,
  bit: number,
): OverrideTriState {
  if ((allowBits & bit) === bit) return 'allow';
  if ((denyBits & bit) === bit) return 'deny';
  return 'neutral';
}

/**
 * Returns new allow/deny masks with `bit` moved to `state`. Always clears the bit from both
 * masks first, so allow/deny can never overlap regardless of the previous state.
 */
export function withOverrideState(
  allowBits: number,
  denyBits: number,
  bit: number,
  state: OverrideTriState,
): { allowBits: number; denyBits: number } {
  const allow = allowBits & ~bit;
  const deny = denyBits & ~bit;
  return {
    allowBits: state === 'allow' ? allow | bit : allow,
    denyBits: state === 'deny' ? deny | bit : deny,
  };
}

// Guild-scoped permissions (Manage Server, Kick, Ban, invites, audit log, Administrator, ...)
// make no sense as a per-channel override — the editor only offers channel-scoped bits:
// the General pair that gates the channel itself, plus the matching media group.
const CHANNEL_GENERAL_BITS = new Set([1 << 0, 1 << 1]); // View Channels, Manage Channels

/**
 * The permission groups the override editor shows for a channel type: a trimmed General group
 * (View/Manage Channels) plus the Text group for text-like channels or the Voice group for
 * voice channels. Reuses PERMISSION_GROUPS so labels/descriptions stay single-sourced.
 */
export function overridePermGroups(type: ChannelType): PermissionGroup[] {
  const media = type === 'voice' ? 'Voice' : 'Text';
  return PERMISSION_GROUPS.map((g) =>
    g.category === 'General'
      ? { ...g, perms: g.perms.filter((p) => CHANNEL_GENERAL_BITS.has(p.bit)) }
      : g,
  ).filter((g) => g.category === 'General' || g.category === media);
}
