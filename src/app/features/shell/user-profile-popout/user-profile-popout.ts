import { Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { UiAvatar } from '../../../shared/ui';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { ToastService } from '../../../core/services/toast.service';
import { roleColorHex } from '../../../core/models/role.models';
import { toAvatarStatus } from '../../../core/models/presence.models';
import { snowflakeToDate } from '../../../shared/util/snowflake';

/**
 * Clickable-user profile card: identity, presence + custom status, "Member Since", and the
 * member's roles as colour chips. A Message button opens a DM (hidden for yourself). Resolves
 * everything from the stores given a `userId` + `guildId`; falls back to the supplied identity
 * when the member record isn't loaded (or in a DM, where there are no roles). Anchored by the
 * caller in a CDK overlay. "View Full Profile" is deferred to the profile page (§5.24 #13).
 */
@Component({
  selector: 'app-user-profile-popout',
  standalone: true,
  imports: [UiAvatar],
  templateUrl: './user-profile-popout.html',
})
export class UserProfilePopout {
  readonly userId = input.required<string>();
  readonly guildId = input<string | null>(null);
  readonly fallbackUsername = input('');
  readonly fallbackAvatarKey = input<string | null>(null);
  readonly close = output<void>();

  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly auth = inject(AuthService);
  private readonly profileModal = inject(ProfileModalService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly member = computed(() => {
    const guildId = this.guildId();
    return guildId ? this.memberStore.membersOf(guildId).find((m) => m.userId === this.userId()) : undefined;
  });

  protected readonly username = computed(() => this.member()?.username ?? this.fallbackUsername());
  // In a guild the server nickname is the display name; in a DM the caller's private friend nickname is.
  protected readonly displayName = computed(() => {
    if (this.guildId()) return this.member()?.nickname ?? this.username();
    return this.nicknameStore.nicknameOf(this.userId()) ?? this.username();
  });
  protected readonly hasNickname = computed(() => this.displayName() !== this.username());
  protected readonly avatarKey = computed(() => this.member()?.avatarKey ?? this.fallbackAvatarKey());
  protected readonly isOwner = computed(() => this.member()?.isOwner ?? false);
  protected readonly isSelf = computed(() => this.userId() === this.auth.currentUser()?.id);

  protected readonly avatarStatus = computed(() => toAvatarStatus(this.presenceStore.statusOf(this.userId())));
  protected readonly statusMessage = computed(() => this.presenceStore.statusMessageOf(this.userId()));

  /** The member's roles (excluding @everyone), highest-rank first, with their colours. */
  protected readonly roleChips = computed(() => {
    const guildId = this.guildId();
    const member = this.member();
    if (!guildId || !member) return [];
    const ids = new Set(member.roleIds);
    return this.roleStore
      .rolesOf(guildId)
      .filter((r) => !r.isDefault && ids.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, color: roleColorHex(r.color) }));
  });

  /** "Member Since" — the guild join date when known, else the account-creation date from the id. */
  protected readonly memberSince = computed(() => {
    const joined = this.member()?.joinedAt;
    const date = joined != null ? new Date(joined) : snowflakeToDate(this.userId());
    return date ? date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  });

  async message(): Promise<void> {
    if (this.isSelf()) return;
    try {
      const dm = await this.dmStore.open(this.userId());
      this.close.emit();
      await this.router.navigate(['/app/dm', dm.channelId]);
    } catch {
      // friends_only stranger (or block) — the server rejects opening the DM.
      this.toast.info('This user only accepts messages from friends.', 'fa-user-lock');
    }
  }

  viewFullProfile(): void {
    this.profileModal.open(this.userId(), this.guildId());
    this.close.emit();
  }
}
