import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { CreateRolePayload, Role, UpdateRolePayload } from '../models/role.models';
import { RoleService } from '../services/role.service';

interface RoleState {
  byGuild: Record<string, Role[]>;
}

/** Keeps a guild's role list sorted by rank (position desc, then id desc to break ties). */
const sortRoles = (roles: Role[]): Role[] =>
  [...roles].sort((a, b) => b.position - a.position || (a.id < b.id ? 1 : -1));

export const RoleStore = signalStore(
  { providedIn: 'root' },
  withState<RoleState>({ byGuild: {} }),
  withMethods((store, service = inject(RoleService)) => {
    const setGuild = (guildId: string, roles: Role[]) =>
      patchState(store, { byGuild: { ...store.byGuild(), [guildId]: sortRoles(roles) } });

    const upsert = (role: Role) => {
      const list = store.byGuild()[role.guildId];
      if (!list) return;
      const next = list.some((r) => r.id === role.id)
        ? list.map((r) => (r.id === role.id ? role : r))
        : [...list, role];
      setGuild(role.guildId, next);
    };

    return {
      rolesOf(guildId: string): Role[] {
        return store.byGuild()[guildId] ?? [];
      },

      /** Fetches a guild's roles once and caches them; a no-op if already cached. */
      async loadIfNeeded(guildId: string): Promise<void> {
        if (store.byGuild()[guildId]) return;
        try {
          setGuild(guildId, await service.getRoles(guildId));
        } catch {
          // Leave unset; the modal shows an error / empty state.
        }
      },

      /** Forces a refresh (used when the management modal opens). */
      async reload(guildId: string): Promise<void> {
        setGuild(guildId, await service.getRoles(guildId));
      },

      async create(guildId: string, body: CreateRolePayload): Promise<Role> {
        const role = await service.createRole(guildId, body);
        upsert(role);
        return role;
      },

      async update(guildId: string, roleId: string, body: UpdateRolePayload): Promise<Role> {
        const role = await service.updateRole(guildId, roleId, body);
        upsert(role);
        return role;
      },

      async remove(guildId: string, roleId: string): Promise<void> {
        await service.deleteRole(guildId, roleId);
        this.applyRoleDeleted(guildId, roleId);
      },

      async reorder(
        guildId: string,
        positions: { roleId: string; position: number }[],
      ): Promise<void> {
        await service.reorder(guildId, positions);
        const map = new Map(positions.map((p) => [p.roleId, p.position]));
        const list = store.byGuild()[guildId] ?? [];
        setGuild(
          guildId,
          list.map((r) => (map.has(r.id) ? { ...r, position: map.get(r.id)! } : r)),
        );
      },

      // ---- SignalR apply-methods ----
      applyRoleUpserted(role: Role): void {
        upsert(role);
      },

      applyRoleDeleted(guildId: string, roleId: string): void {
        const list = store.byGuild()[guildId];
        if (!list) return;
        setGuild(guildId, list.filter((r) => r.id !== roleId));
      },
    };
  }),
);
