import { describe, it, expect } from 'vitest';
import { buildUserMenu, UserMenuDeps, UserMenuTarget } from './user-context-menu';
import { ContextMenuEntry, ContextMenuItem, isSeparator } from '../../core/models/context-menu.models';

/** Labels of the non-separator entries, in order. */
function labels(entries: ContextMenuEntry[]): string[] {
  return entries.filter((e): e is ContextMenuItem => !isSeparator(e)).map((e) => e.label);
}

function deps(overrides: Partial<Record<string, unknown>> = {}): UserMenuDeps {
  return {
    memberStore: { membersOf: () => [], applyMemberRoleUpdated: () => {} },
    roleStore: { rolesOf: () => [] },
    roleService: {},
    dmStore: {},
    blockStore: { isBlocked: () => false, block: () => Promise.resolve(), unblock: () => Promise.resolve() },
    profileModal: {},
    toast: {},
    router: {},
    auth: { currentUser: () => ({ id: 'me' }) },
    ...overrides,
  } as unknown as UserMenuDeps;
}

const modCaps = { canManageRoles: true, canTimeout: true, canKick: true, canBan: true } as never;

function target(over: Partial<UserMenuTarget> = {}): UserMenuTarget {
  return { userId: 'u1', guildId: 'g1', username: 'bob', ...over };
}

describe('buildUserMenu', () => {
  it('offers Profile + Message + Copy + Block for another user with no moderation context', () => {
    const entries = buildUserMenu(deps(), target({ guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Message', 'Copy User ID', 'Block']);
  });

  it('hides Message and Block for yourself', () => {
    const entries = buildUserMenu(deps(), target({ userId: 'me', guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID']);
  });

  it('offers Unblock instead of Block for an already-blocked user', () => {
    const d = deps({ blockStore: { isBlocked: () => true } });
    const entries = buildUserMenu(d, target({ guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Message', 'Copy User ID', 'Unblock']);
  });

  it('appends moderation for a non-owner member the caller can moderate', () => {
    const d = deps({ roleStore: { rolesOf: () => [{ id: 'r1', name: 'Mod', isDefault: false }] } });
    const entries = buildUserMenu(
      d,
      target({ member: { userId: 'u1', username: 'bob', isOwner: false, roleIds: [] } as never, caps: modCaps }),
    );
    expect(labels(entries)).toEqual(['Profile', 'Message', 'Copy User ID', 'Roles', 'Timeout', 'Kick', 'Ban', 'Block']);
    expect(entries.some(isSeparator)).toBe(true);
  });

  it('omits the Roles submenu when there are no assignable roles', () => {
    const entries = buildUserMenu(
      deps(),
      target({ member: { userId: 'u1', username: 'bob', isOwner: false, roleIds: [] } as never, caps: modCaps }),
    );
    expect(labels(entries)).not.toContain('Roles');
    expect(labels(entries)).toContain('Kick');
  });

  it('never moderates the guild owner (but can still block them)', () => {
    const entries = buildUserMenu(
      deps(),
      target({ member: { userId: 'u1', username: 'bob', isOwner: true, roleIds: [] } as never, caps: modCaps }),
    );
    expect(labels(entries)).toEqual(['Profile', 'Message', 'Copy User ID', 'Block']);
  });
});
