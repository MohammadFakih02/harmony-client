/** A guild role. `color` is an RGB int (0 = no color). `permissionBits` is a small int (HTTP sends it
 *  as a number; SignalR sends it as a string, coerced in the hub client). Higher `position` = higher rank. */
export interface Role {
  id: string;
  guildId: string;
  name: string;
  color: number;
  permissionBits: number;
  position: number;
  isHoisted: boolean;
  isMentionable: boolean;
  isDefault: boolean;
}

export interface CreateRolePayload {
  name: string;
  color?: number;
  permissionBits?: number;
  isHoisted?: boolean;
  isMentionable?: boolean;
}

export type UpdateRolePayload = Partial<Omit<CreateRolePayload, 'name'>> & { name?: string };

/** SignalR: a role was deleted from a guild. */
export interface RoleDeletedPayload {
  guildId: string;
  roleId: string;
}

/** SignalR: a member's role-id set changed. */
export interface MemberRoleUpdatedPayload {
  guildId: string;
  userId: string;
  roleIds: string[];
}

/** Render an RGB int as a CSS hex color, or null when uncolored (0). */
export function roleColorHex(color: number): string | null {
  return color ? `#${(color & 0xffffff).toString(16).padStart(6, '0')}` : null;
}

/**
 * The colour a member's name renders in: the highest-ranked role they hold that carries a colour.
 * `rolesByRankDesc` must be rank-sorted (RoleStore.rolesOf is). Null when none of their roles is
 * coloured (e.g. only @everyone) or in a DM.
 */
export function memberColor(roleIds: string[], rolesByRankDesc: Role[]): string | null {
  const ids = new Set(roleIds);
  for (const r of rolesByRankDesc) {
    if (ids.has(r.id)) {
      const hex = roleColorHex(r.color);
      if (hex) return hex;
    }
  }
  return null;
}

/** The highest-ranked *hoisted* role a member holds (the member-list section they group under), or null. */
export function memberHoistRole(roleIds: string[], rolesByRankDesc: Role[]): Role | null {
  const ids = new Set(roleIds);
  for (const r of rolesByRankDesc) {
    if (r.isHoisted && ids.has(r.id)) return r;
  }
  return null;
}
