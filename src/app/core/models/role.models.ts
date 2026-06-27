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
