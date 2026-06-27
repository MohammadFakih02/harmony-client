import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { RoleService } from '../../../core/services/role.service';
import { GuildCapabilities, GuildMember } from '../../../core/models/member.models';
import { Role, roleColorHex } from '../../../core/models/role.models';

interface TimeoutOption {
  label: string;
  seconds: number;
}

/**
 * Moderation action menu for a single guild member (kick / ban / timeout), rendered inside the
 * member-sidebar's CDK overlay. Each action is shown only if the caller holds the matching
 * capability; kick/ban require a confirm step (ban takes an optional reason). Calls MemberStore
 * directly and emits `close` once an action succeeds or the user backs out.
 */
@Component({
  selector: 'app-member-actions-menu',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './member-actions-menu.html',
  host: { class: 'block' },
})
export class MemberActionsMenu {
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly roleService = inject(RoleService);

  readonly guildId = input.required<string>();
  readonly member = input.required<GuildMember>();
  readonly caps = input.required<GuildCapabilities>();
  readonly close = output<void>();

  protected readonly view = signal<'root' | 'timeout' | 'kick' | 'ban' | 'roles'>('root');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly banReason = signal('');
  protected readonly colorHex = roleColorHex;

  /** Assignable roles (everything except the implicit @everyone). */
  protected readonly assignableRoles = computed(() =>
    this.roleStore.rolesOf(this.guildId()).filter((r) => !r.isDefault),
  );

  /** The member's current role-ids, read live from the store so toggles reflect immediately. */
  protected readonly memberRoleIds = computed(() => {
    const live = this.memberStore.membersOf(this.guildId()).find((m) => m.userId === this.member().userId);
    return new Set(live?.roleIds ?? this.member().roleIds);
  });

  protected hasRole(roleId: string): boolean {
    return this.memberRoleIds().has(roleId);
  }

  protected readonly timeoutOptions: TimeoutOption[] = [
    { label: '60 seconds', seconds: 60 },
    { label: '5 minutes', seconds: 300 },
    { label: '10 minutes', seconds: 600 },
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '1 week', seconds: 604800 },
  ];

  protected readonly isTimedOut = computed(() => {
    const until = this.member().communicationDisabledUntil;
    return until != null && until > Date.now();
  });

  protected readonly name = computed(() => this.member().nickname ?? this.member().username);

  private async run(action: Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action;
      this.close.emit();
    } catch {
      this.error.set('Action failed. Check your permissions and try again.');
      this.busy.set(false);
    }
  }

  protected applyTimeout(seconds: number): void {
    this.run(this.memberStore.timeout(this.guildId(), this.member().userId, seconds));
  }

  protected removeTimeout(): void {
    this.run(this.memberStore.clearTimeout(this.guildId(), this.member().userId));
  }

  protected kick(): void {
    this.run(this.memberStore.kick(this.guildId(), this.member().userId));
  }

  protected ban(): void {
    const reason = this.banReason().trim();
    this.run(this.memberStore.ban(this.guildId(), this.member().userId, reason || null));
  }

  /** Assign/unassign a role. Stays open (you may toggle several); optimistic with revert on failure. */
  protected async toggleRole(role: Role): Promise<void> {
    if (this.busy()) return;
    const userId = this.member().userId;
    const has = this.hasRole(role.id);
    const current = [...this.memberRoleIds()];
    const next = has ? current.filter((id) => id !== role.id) : [...current, role.id];

    this.busy.set(true);
    this.error.set('');
    this.memberStore.applyMemberRoleUpdated(this.guildId(), userId, next); // optimistic
    try {
      if (has) await this.roleService.unassign(this.guildId(), role.id, userId);
      else await this.roleService.assign(this.guildId(), role.id, userId);
    } catch {
      this.memberStore.applyMemberRoleUpdated(this.guildId(), userId, current); // revert
      this.error.set('Could not change roles — you can only assign roles below your highest.');
    } finally {
      this.busy.set(false);
    }
  }
}
