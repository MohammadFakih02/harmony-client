import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UiAvatar, UiProfileBanner, bannerGradient } from '../../../shared/ui';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { AuthService } from '../../../core/services/auth.service';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { ProfileStore } from '../../../core/stores/profile.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { ToastService } from '../../../core/services/toast.service';
import { roleColorHex } from '../../../core/models/role.models';
import { toAvatarStatus } from '../../../core/models/presence.models';
import { snowflakeToDate } from '../../../shared/util/snowflake';

const fmtDate = (d: Date | null): string | null =>
  d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * Full-profile modal (the "View Full Profile" target from the user popout). Hosted once in the
 * shell, driven by {@link ProfileModalService}, and **view-only** — profiles are read through the
 * shared {@link ProfileStore} cache, and your own profile is edited in Settings ▸ Profile (the
 * Edit Profile button routes there). Server/friend nicknames stay editable here: they're
 * per-target, contextual settings, not profile fields.
 */
@Component({
  selector: 'app-user-profile-modal',
  standalone: true,
  imports: [UiAvatar, UiProfileBanner, FormsModule],
  templateUrl: './user-profile-modal.html',
})
export class UserProfileModal {
  protected readonly profileModal = inject(ProfileModalService);
  private readonly profileStore = inject(ProfileStore);
  private readonly auth = inject(AuthService);
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly userId = computed(() => this.profileModal.target()?.userId ?? null);
  protected readonly guildId = computed(() => this.profileModal.target()?.guildId ?? null);
  protected readonly isSelf = computed(() => this.userId() === this.auth.currentUser()?.id);

  /** The shared cached profile — paints instantly on re-open while a refresh runs behind it. */
  protected readonly view = computed(() => {
    const id = this.userId();
    return id ? (this.profileStore.profileOf(id) ?? null) : null;
  });

  /** Whether the Message action should be offered — server-resolved against the target's whole
   *  DM-privacy checklist (friends / shared guild / everyone), not just yourself. */
  protected readonly canMessage = computed(() => {
    if (this.isSelf() || !this.userId()) return false;
    return this.view()?.canMessage ?? false;
  });

  private readonly member = computed(() => {
    const t = this.profileModal.target();
    return t?.guildId ? this.memberStore.membersOf(t.guildId).find((m) => m.userId === t.userId) : undefined;
  });
  protected readonly isOwner = computed(() => this.member()?.isOwner ?? false);

  // ---- nicknames ----
  // Server nickname (guild-scoped): editable for yourself, or for others with ManageNicknames.
  protected readonly serverNickname = computed(() => this.member()?.nickname ?? null);
  protected readonly canEditServerNick = computed(() => {
    const gid = this.guildId();
    if (!gid || !this.member()) return false;
    if (this.isSelf()) return true;
    return this.memberStore.capabilitiesOf(gid)?.canManageNicknames ?? false;
  });
  // Friend nickname (private, global): a personal note you can set for anyone but yourself.
  protected readonly friendNickname = computed(() => {
    const id = this.userId();
    return id ? this.nicknameStore.nicknameOf(id) : null;
  });

  protected readonly serverNickDraft = signal('');
  protected readonly editingServerNick = signal(false);
  protected readonly savingServerNick = signal(false);
  protected readonly friendNickDraft = signal('');
  protected readonly editingFriendNick = signal(false);
  protected readonly savingFriendNick = signal(false);

  protected readonly avatarStatus = computed(() => {
    const id = this.userId();
    return id ? toAvatarStatus(this.presenceStore.statusOf(id)) : 'offline';
  });

  protected readonly roleChips = computed(() => {
    const t = this.profileModal.target();
    const member = this.member();
    if (!t?.guildId || !member) return [];
    const ids = new Set(member.roleIds);
    return this.roleStore
      .rolesOf(t.guildId)
      .filter((r) => !r.isDefault && ids.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, color: roleColorHex(r.color) }));
  });

  /** Banner gradient fallback — the member's top coloured role, else the theme accent. */
  protected readonly bannerStyle = computed(() =>
    bannerGradient(this.roleChips().find((r) => r.color)?.color),
  );

  /** Nickname-aware display name: server nickname in a guild, private friend nickname elsewhere. */
  protected readonly displayName = computed(() => {
    const v = this.view();
    if (!v) return '';
    if (this.guildId()) return this.member()?.nickname ?? v.username;
    const id = this.userId();
    return (id ? this.nicknameStore.nicknameOf(id) : null) ?? v.username;
  });
  protected readonly hasNickname = computed(() => {
    const v = this.view();
    return !!v && this.displayName() !== v.username;
  });

  /** Account-creation date, from the snowflake — always known. */
  protected readonly accountSince = computed(() => {
    const id = this.userId();
    return id ? fmtDate(snowflakeToDate(id)) : null;
  });

  /** Guild join date — only when viewing a loaded guild member. */
  protected readonly serverSince = computed(() => {
    const joined = this.member()?.joinedAt;
    return joined != null ? fmtDate(new Date(joined)) : null;
  });

  constructor() {
    effect(() => {
      const target = this.profileModal.target();
      if (target) untracked(() => this.load(target.userId));
    });
  }

  private async load(userId: string): Promise<void> {
    this.error.set('');
    this.editingServerNick.set(false);
    this.editingFriendNick.set(false);
    this.loading.set(!this.profileStore.profileOf(userId)); // cached copy paints instantly
    const fresh = await this.profileStore.refresh(userId);
    if (!fresh && !this.profileStore.profileOf(userId)) this.error.set('Could not load this profile.');
    this.loading.set(false);
  }

  protected close(): void {
    this.profileModal.close();
  }

  /** Your profile is edited in Settings ▸ My Account — one editor, no nested edit modes. */
  protected editProfile(): void {
    this.close();
    void this.router.navigate(['/app/settings'], { queryParams: { tab: 'account' } });
  }

  // ---- server nickname edit ----
  protected startServerNickEdit(): void {
    this.serverNickDraft.set(this.serverNickname() ?? '');
    this.error.set('');
    this.editingServerNick.set(true);
  }

  protected async saveServerNick(): Promise<void> {
    const gid = this.guildId();
    const id = this.userId();
    if (this.savingServerNick() || !gid || !id) return;
    this.savingServerNick.set(true);
    try {
      const value = this.serverNickDraft().trim() || null;
      if (this.isSelf()) await this.memberStore.setOwnNickname(gid, id, value);
      else await this.memberStore.setNickname(gid, id, value);
      this.editingServerNick.set(false);
    } catch {
      this.error.set('Could not update the server nickname.');
    } finally {
      this.savingServerNick.set(false);
    }
  }

  // ---- friend (private) nickname edit ----
  protected startFriendNickEdit(): void {
    this.friendNickDraft.set(this.friendNickname() ?? '');
    this.error.set('');
    this.editingFriendNick.set(true);
  }

  protected async saveFriendNick(): Promise<void> {
    const id = this.userId();
    if (this.savingFriendNick() || !id) return;
    this.savingFriendNick.set(true);
    try {
      await this.nicknameStore.set(id, this.friendNickDraft());
      this.editingFriendNick.set(false);
    } finally {
      this.savingFriendNick.set(false);
    }
  }

  protected async message(): Promise<void> {
    const id = this.userId();
    if (!id) return;
    try {
      const dm = await this.dmStore.open(id);
      this.close();
      await this.router.navigate(['/app/dm', dm.channelId]);
    } catch {
      // friends_only stranger (or block) — the server rejects opening the DM.
      this.toast.info('This user only accepts messages from friends.', 'fa-user-lock');
    }
  }
}
