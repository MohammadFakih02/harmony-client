import { Router } from '@angular/router';
import { ContextMenuEntry } from '../../core/models/context-menu.models';
import { GuildCapabilities, GuildMember } from '../../core/models/member.models';
import { MemberStore } from '../../core/stores/member.store';
import { RoleStore } from '../../core/stores/role.store';
import { DmStore } from '../../core/stores/dm.store';
import { FriendStore } from '../../core/stores/friend.store';
import { BlockStore } from '../../core/stores/block.store';
import { MuteStore } from '../../core/stores/mute.store';
import { MUTE_DURATIONS } from '../../core/models/mute.models';
import { RoleService } from '../../core/services/role.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmService } from '../../shared/ui';

/** The stores/services a user context menu needs — passed once so the builder stays a pure function. */
export interface UserMenuDeps {
  memberStore: InstanceType<typeof MemberStore>;
  roleStore: InstanceType<typeof RoleStore>;
  roleService: RoleService;
  dmStore: InstanceType<typeof DmStore>;
  friendStore: InstanceType<typeof FriendStore>;
  blockStore: InstanceType<typeof BlockStore>;
  muteStore: InstanceType<typeof MuteStore>;
  profileModal: ProfileModalService;
  toast: ToastService;
  router: Router;
  auth: AuthService;
  confirm: ConfirmService;
}

export interface UserMenuTarget {
  userId: string;
  guildId: string | null;
  username: string;
  member?: GuildMember; // present in a guild context (drives moderation + owner check)
  caps?: GuildCapabilities | null;
}

const TIMEOUT_PRESETS: { label: string; seconds: number }[] = [
  { label: '60 seconds', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '10 minutes', seconds: 600 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '1 week', seconds: 604800 },
];

/**
 * Builds the entries for a user context menu (member sidebar rows + chat authors). Always offers
 * Profile / Message (+ Add Friend for a stranger); when the caller can moderate a non-owner,
 * non-self guild member it appends Roles ▸ / Timeout ▸ / Kick / Ban. Moderation logic lives in
 * MemberStore/RoleService — the builder only wires the actions. Role toggles are optimistic
 * (revert + toast on failure) and keep the menu open so several can be flipped in a row.
 */
export function buildUserMenu(deps: UserMenuDeps, target: UserMenuTarget): ContextMenuEntry[] {
  const { userId, guildId, member, caps } = target;
  const isSelf = userId === deps.auth.currentUser()?.id;

  const entries: ContextMenuEntry[] = [
    {
      label: 'Profile',
      icon: 'fa-user',
      action: () => deps.profileModal.open(userId, guildId),
    },
    {
      label: 'Copy User ID',
      icon: 'fa-hashtag',
      action: () =>
        void navigator.clipboard?.writeText(userId).then(
          () => deps.toast.info('Copied user ID'),
          () => deps.toast.info('Copy failed', 'fa-triangle-exclamation'),
        ),
    },
  ];

  if (!isSelf) {
    entries.push({
      label: 'Message',
      icon: 'fa-message',
      action: async () => {
        try {
          const dm = await deps.dmStore.open(userId);
          await deps.router.navigate(['/app/dm', dm.channelId]);
        } catch {
          deps.toast.info('This user only accepts messages from friends.', 'fa-user-lock');
        }
      },
    });
    appendAddFriendEntry(deps, target, entries);
  }

  // Role assignment is offered for anyone the caller can manage — INCLUDING yourself: you can
  // give yourself a role below your highest (the owner bypasses hierarchy server-side). Other
  // moderation (Timeout/Kick/Ban) stays non-self and non-owner. A non-self owner target is never
  // manageable.
  const canManage = !!guildId && !!member && !!caps;
  const canAssignRoles = canManage && caps!.canManageRoles && (isSelf || !member!.isOwner);
  const canModerate = canManage && !isSelf && !member!.isOwner;
  if (!canAssignRoles && !canModerate) {
    appendMuteEntry(deps, target, entries, isSelf);
    appendBlockEntry(deps, target, entries, isSelf);
    return entries;
  }

  const gid = guildId!;
  const mod: ContextMenuEntry[] = [];

  if (canAssignRoles) {
    const roles = deps.roleStore.rolesOf(gid).filter((r) => !r.isDefault);
    if (roles.length > 0) {
      mod.push({
        label: 'Roles',
        icon: 'fa-user-tag',
        children: roles.map((role) => ({
          label: role.name,
          keepOpen: true,
          checked: () => currentRoleIds(deps, gid, userId, member!).includes(role.id),
          action: () => toggleRole(deps, gid, userId, member!, role.id),
        })),
      });
    }
  }

  if (canModerate && caps!.canTimeout) {
    const timedOut =
      member!.communicationDisabledUntil != null && member!.communicationDisabledUntil > Date.now();
    const timeoutChildren: ContextMenuEntry[] = TIMEOUT_PRESETS.map((preset) => ({
      label: preset.label,
      action: () => run(deps, deps.memberStore.timeout(gid, userId, preset.seconds)),
    }));
    if (timedOut) {
      timeoutChildren.push(
        { separator: true },
        {
          label: 'Remove Timeout',
          icon: 'fa-hourglass-end',
          action: () => run(deps, deps.memberStore.clearTimeout(gid, userId)),
        },
      );
    }
    mod.push({ label: 'Timeout', icon: 'fa-clock', children: timeoutChildren });
  }

  if (canModerate && caps!.canKick) {
    mod.push({
      label: 'Kick',
      icon: 'fa-user-slash',
      danger: true,
      action: async () => {
        const ok = await deps.confirm.confirm({
          title: 'Kick Member',
          message: `Kick ${displayName(target)} from the server?`,
          confirmLabel: 'Kick',
          danger: true,
        });
        if (ok) void run(deps, deps.memberStore.kick(gid, userId));
      },
    });
  }

  if (canModerate && caps!.canBan) {
    mod.push({
      label: 'Ban',
      icon: 'fa-ban',
      danger: true,
      action: async () => {
        const res = await deps.confirm.confirm({
          title: 'Ban Member',
          message: `Ban ${displayName(target)} from the server? They won't be able to rejoin unless unbanned.`,
          confirmLabel: 'Ban',
          danger: true,
          input: { label: 'Reason (optional)', placeholder: 'Reason for the ban' },
        });
        if (!res) return;
        void run(deps, deps.memberStore.ban(gid, userId, res.input || null));
      },
    });
  }

  if (mod.length > 0) entries.push({ separator: true }, ...mod);
  appendMuteEntry(deps, target, entries, isSelf);
  appendBlockEntry(deps, target, entries, isSelf);
  return entries;
}

/**
 * Add Friend — offered for a non-self user who isn't already a friend, has no pending request
 * in either direction, and isn't blocked. Sends by username (the server resolves + validates).
 */
function appendAddFriendEntry(
  deps: UserMenuDeps,
  target: UserMenuTarget,
  entries: ContextMenuEntry[],
): void {
  const { userId, username } = target;
  if (
    !username ||
    deps.friendStore.friends().some((f) => f.id === userId) ||
    deps.friendStore.pending().some((p) => p.id === userId) ||
    deps.blockStore.isBlocked(userId)
  ) {
    return;
  }
  entries.push({
    label: 'Add Friend',
    icon: 'fa-user-plus',
    action: async () => {
      try {
        await deps.friendStore.sendRequest(username);
        deps.toast.info(`Friend request sent to @${username}`, 'fa-user-plus');
      } catch {
        deps.toast.info('Could not send a friend request to this user.', 'fa-triangle-exclamation');
      }
    },
  });
}

/**
 * Mute / Unmute — offered for any other user, just above the Block section. A user mute is a
 * personal notification preference (suppresses their mentions/replies + hides their typing),
 * softer than a block: their messages stay visible.
 */
function appendMuteEntry(
  deps: UserMenuDeps,
  target: UserMenuTarget,
  entries: ContextMenuEntry[],
  isSelf: boolean,
): void {
  if (isSelf) return;
  const muted = deps.muteStore.isMuted('user', target.userId);
  entries.push(
    { separator: true },
    muted
      ? {
          label: `Unmute @${target.username}`,
          icon: 'fa-bell',
          action: () => void deps.muteStore.remove('user', target.userId),
        }
      : {
          label: `Mute @${target.username}`,
          icon: 'fa-bell-slash',
          children: MUTE_DURATIONS.map((d) => ({
            label: d.label,
            action: () => void deps.muteStore.mute('user', target.userId, d.minutes),
          })),
        },
  );
}

/** Block / Unblock — offered for any other user, always as the last section (Discord-style). */
function appendBlockEntry(
  deps: UserMenuDeps,
  target: UserMenuTarget,
  entries: ContextMenuEntry[],
  isSelf: boolean,
): void {
  if (isSelf) return;
  const blocked = deps.blockStore.isBlocked(target.userId);
  entries.push(
    { separator: true },
    blocked
      ? {
          label: 'Unblock',
          icon: 'fa-user-check',
          action: () => void deps.blockStore.unblock(target.userId),
        }
      : {
          label: 'Block',
          icon: 'fa-user-slash',
          danger: true,
          action: async () => {
            const ok = await deps.confirm.confirm({
              title: 'Block User',
              message: `Block ${displayName(target)}? Their messages will be hidden and any friendship removed.`,
              confirmLabel: 'Block',
              danger: true,
            });
            if (!ok) return;
            try {
              await deps.blockStore.block({
                id: target.userId,
                username: target.username,
                avatarKey: target.member?.avatarKey ?? null,
              });
              deps.toast.info(`Blocked ${displayName(target)}`, 'fa-user-slash');
            } catch {
              deps.toast.info('Could not block this user.', 'fa-triangle-exclamation');
            }
          },
        },
  );
}

function displayName(target: UserMenuTarget): string {
  return target.member?.nickname ?? target.username;
}

/** The member's live role-ids from the store (so the check indicator tracks toggles), or the snapshot. */
function currentRoleIds(deps: UserMenuDeps, guildId: string, userId: string, snapshot: GuildMember): string[] {
  return deps.memberStore.membersOf(guildId).find((m) => m.userId === userId)?.roleIds ?? snapshot.roleIds;
}

async function toggleRole(
  deps: UserMenuDeps,
  guildId: string,
  userId: string,
  snapshot: GuildMember,
  roleId: string,
): Promise<void> {
  const current = currentRoleIds(deps, guildId, userId, snapshot);
  const has = current.includes(roleId);
  const next = has ? current.filter((id) => id !== roleId) : [...current, roleId];
  deps.memberStore.applyMemberRoleUpdated(guildId, userId, next); // optimistic
  try {
    if (has) await deps.roleService.unassign(guildId, roleId, userId);
    else await deps.roleService.assign(guildId, roleId, userId);
  } catch {
    deps.memberStore.applyMemberRoleUpdated(guildId, userId, current); // revert
    deps.toast.info('You can only assign roles below your highest.', 'fa-triangle-exclamation');
  }
}

/** Awaits a moderation action and surfaces a generic toast on failure (permission/rank rejections). */
async function run(deps: UserMenuDeps, action: Promise<void>): Promise<void> {
  try {
    await action;
  } catch {
    deps.toast.info('Action failed. Check your permissions and try again.', 'fa-triangle-exclamation');
  }
}
