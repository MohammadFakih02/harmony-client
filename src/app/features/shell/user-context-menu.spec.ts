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
    friendStore: { friends: () => [], pending: () => [], sendRequest: () => Promise.resolve() },
    blockStore: { isBlocked: () => false, block: () => Promise.resolve(), unblock: () => Promise.resolve() },
    muteStore: { isMuted: () => false, mute: () => Promise.resolve(), remove: () => Promise.resolve() },
    profileModal: {},
    toast: {},
    router: {},
    auth: { currentUser: () => ({ id: 'me' }) },
    confirm: { confirm: () => Promise.resolve(null), notice: () => Promise.resolve() },
    ...overrides,
  } as unknown as UserMenuDeps;
}

const modCaps = { canManageRoles: true, canTimeout: true, canKick: true, canBan: true } as never;

function target(over: Partial<UserMenuTarget> = {}): UserMenuTarget {
  return { userId: 'u1', guildId: 'g1', username: 'bob', ...over };
}

describe('buildUserMenu', () => {
  it('offers Profile + Message + Add Friend + Block for another user with no moderation context', () => {
    const entries = buildUserMenu(deps(), target({ guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID', 'Message', 'Add Friend', 'Mute @bob', 'Block']);
  });

  it('hides Message, Add Friend and Block for yourself', () => {
    const entries = buildUserMenu(deps(), target({ userId: 'me', guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID']);
  });

  it('hides Add Friend when already friends or a request is pending', () => {
    const friend = deps({ friendStore: { friends: () => [{ id: 'u1' }], pending: () => [] } });
    expect(labels(buildUserMenu(friend, target({ guildId: null })))).not.toContain('Add Friend');
    const pending = deps({ friendStore: { friends: () => [], pending: () => [{ id: 'u1' }] } });
    expect(labels(buildUserMenu(pending, target({ guildId: null })))).not.toContain('Add Friend');
  });

  it('offers Unblock instead of Block for an already-blocked user', () => {
    const d = deps({ blockStore: { isBlocked: () => true } });
    const entries = buildUserMenu(d, target({ guildId: null }));
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID', 'Message', 'Mute @bob', 'Unblock']);
  });

  it('appends moderation for a non-owner member the caller can moderate', () => {
    const d = deps({ roleStore: { rolesOf: () => [{ id: 'r1', name: 'Mod', isDefault: false }] } });
    const entries = buildUserMenu(
      d,
      target({ member: { userId: 'u1', username: 'bob', isOwner: false, roleIds: [] } as never, caps: modCaps }),
    );
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID', 'Message', 'Add Friend', 'Roles', 'Timeout', 'Kick', 'Ban', 'Mute @bob', 'Block']);
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
    expect(labels(entries)).toEqual(['Profile', 'Copy User ID', 'Message', 'Add Friend', 'Mute @bob', 'Block']);
  });

  it('offers Unmute instead of Mute for an already-muted user', () => {
    const d = deps({ muteStore: { isMuted: () => true, remove: () => Promise.resolve() } });
    const entries = buildUserMenu(d, target({ guildId: null }));
    expect(labels(entries)).toContain('Unmute @bob');
    expect(labels(entries)).not.toContain('Mute @bob');
  });
});
