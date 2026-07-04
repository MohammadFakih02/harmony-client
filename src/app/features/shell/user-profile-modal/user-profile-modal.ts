import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UiAvatar } from '../../../shared/ui';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { DmStore } from '../../../core/stores/dm.store';
import { FriendStore } from '../../../core/stores/friend.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { ToastService } from '../../../core/services/toast.service';
import { DmPrivacy, ageFromIso } from '../../../core/models/user.models';
import { roleColorHex } from '../../../core/models/role.models';
import { toAvatarStatus } from '../../../core/models/presence.models';
import { snowflakeToDate } from '../../../shared/util/snowflake';

interface ProfileView {
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  bio: string | null;
  statusMessage: string | null;
  age: number | null;
  dmPrivacy: DmPrivacy;
}

const fmtDate = (d: Date | null): string | null =>
  d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;

/**
 * Full-profile modal (the "View Full Profile" target from the user popout). Hosted once in the
 * shell, driven by {@link ProfileModalService}. Shows banner/avatar/bio/age/roles/member-since;
 * for yourself it offers an inline edit of bio + date of birth (PATCH /me). Avatar/banner upload
 * is out of scope (lands with the settings shell, §5.24 #15).
 */
@Component({
  selector: 'app-user-profile-modal',
  standalone: true,
  imports: [UiAvatar, FormsModule],
  templateUrl: './user-profile-modal.html',
})
export class UserProfileModal {
  protected readonly profileModal = inject(ProfileModalService);
  private readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly presenceStore = inject(PresenceStore);
  private readonly dmStore = inject(DmStore);
  private readonly friendStore = inject(FriendStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly view = signal<ProfileView | null>(null);

  // Edit state (self only).
  protected readonly editing = signal(false);
  protected readonly bioDraft = signal('');
  protected readonly dobDraft = signal('');
  protected readonly saving = signal(false);
  private dob: string | null = null; // raw ISO DOB for the edit form
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly userId = computed(() => this.profileModal.target()?.userId ?? null);
  protected readonly guildId = computed(() => this.profileModal.target()?.guildId ?? null);
  protected readonly isSelf = computed(() => this.userId() === this.auth.currentUser()?.id);

  private readonly isFriend = computed(() => {
    const id = this.userId();
    return !!id && this.friendStore.friends().some((f) => f.id === id);
  });

  /** Whether the Message action should be offered: not yourself, and not a "friends_only" stranger. */
  protected readonly canMessage = computed(() => {
    if (this.isSelf() || !this.userId()) return false;
    const v = this.view();
    if (!v) return false;
    return v.dmPrivacy !== 'friends_only' || this.isFriend();
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
  protected readonly bannerStyle = computed(() => {
    const c = this.roleChips().find((r) => r.color)?.color ?? 'var(--color-accent)';
    return `linear-gradient(135deg, ${c} 0%, color-mix(in srgb, ${c} 55%, #000) 100%)`;
  });

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
    this.loading.set(true);
    this.error.set('');
    this.editing.set(false);
    this.view.set(null);
    try {
      if (userId === this.auth.currentUser()?.id) {
        const me = await this.userService.getMe();
        this.dob = me.dateOfBirth;
        this.view.set({
          username: me.username,
          avatarKey: me.avatarKey,
          bannerKey: me.bannerKey,
          bio: me.bio,
          statusMessage: me.statusMessage,
          age: ageFromIso(me.dateOfBirth),
          dmPrivacy: me.dmPrivacy,
        });
      } else {
        const p = await this.userService.getProfile(userId);
        this.dob = null;
        this.view.set({
          username: p.username,
          avatarKey: p.avatarKey,
          bannerKey: p.bannerKey,
          bio: p.bio,
          statusMessage: p.statusMessage,
          age: p.age,
          dmPrivacy: p.dmPrivacy,
        });
      }
    } catch {
      this.error.set('Could not load this profile.');
    } finally {
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.profileModal.close();
  }

  protected startEdit(): void {
    this.bioDraft.set(this.view()?.bio ?? '');
    this.dobDraft.set(this.dob ?? '');
    this.error.set('');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.userService.updateProfile({ bio: this.bioDraft(), dateOfBirth: this.dobDraft() });
      const bio = this.bioDraft().trim() || null;
      const dob = this.dobDraft() || null;
      this.dob = dob;
      this.view.update((v) => (v ? { ...v, bio, age: ageFromIso(dob) } : v));
      this.editing.set(false);
    } catch {
      this.error.set('Could not save your profile. Check the date of birth.');
    } finally {
      this.saving.set(false);
    }
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
