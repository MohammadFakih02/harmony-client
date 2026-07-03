import { Router } from '@angular/router';
import { ContextMenuEntry } from '../../core/models/context-menu.models';
import { GuildCapabilities, GuildMember } from '../../core/models/member.models';
import { MemberStore } from '../../core/stores/member.store';
import { RoleStore } from '../../core/stores/role.store';
import { DmStore } from '../../core/stores/dm.store';
import { RoleService } from '../../core/services/role.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

/** The stores/services a user context menu needs — passed once so the builder stays a pure function. */
export interface UserMenuDeps {
  memberStore: InstanceType<typeof MemberStore>;
  roleStore: InstanceType<typeof RoleStore>;
  roleService: RoleService;
  dmStore: InstanceType<typeof DmStore>;
  profileModal: ProfileModalService;
  toast: ToastService;
  router: Router;
  auth: AuthService;
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
 * Profile / Message / Copy User ID; when the caller can moderate a non-owner, non-self guild member it
 * appends Roles ▸ / Timeout ▸ / Kick / Ban. Moderation logic lives in MemberStore/RoleService — the
 * builder only wires the actions. Role toggles are optimistic (revert + toast on failure) and keep the
 * menu open so several can be flipped in a row.
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
  }

  entries.push({
    label: 'Copy User ID',
    icon: 'fa-hashtag',
    action: () => {
      void navigator.clipboard?.writeText(userId).then(
        () => deps.toast.info('Copied user ID'),
        () => deps.toast.info('Copy failed', 'fa-triangle-exclamation'),
      );
    },
  });

  // Moderation — only for a non-self, non-owner member the caller can act on.
  const moderatable =
    !!guildId && !!member && !isSelf && !member.isOwner && !!caps;
  if (!moderatable) return entries;

  const gid = guildId!;
  const mod: ContextMenuEntry[] = [];

  if (caps!.canManageRoles) {
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

  if (caps!.canTimeout) {
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

  if (caps!.canKick) {
    mod.push({
      label: 'Kick',
      icon: 'fa-user-slash',
      danger: true,
      action: () => {
        if (window.confirm(`Kick ${displayName(target)} from the server?`)) {
          void run(deps, deps.memberStore.kick(gid, userId));
        }
      },
    });
  }

  if (caps!.canBan) {
    mod.push({
      label: 'Ban',
      icon: 'fa-ban',
      danger: true,
      action: () => {
        if (!window.confirm(`Ban ${displayName(target)} from the server?`)) return;
        const reason = window.prompt('Reason for the ban (optional):', '')?.trim() || null;
        void run(deps, deps.memberStore.ban(gid, userId, reason));
      },
    });
  }

  if (mod.length > 0) entries.push({ separator: true }, ...mod);
  return entries;
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
