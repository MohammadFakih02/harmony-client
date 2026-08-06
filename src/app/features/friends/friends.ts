import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CdkOverlayOrigin, ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { FriendStore } from '../../core/stores/friend.store';
import { DmStore } from '../../core/stores/dm.store';
import { BlockStore } from '../../core/stores/block.store';
import { MuteStore } from '../../core/stores/mute.store';
import { MemberStore } from '../../core/stores/member.store';
import { RoleStore } from '../../core/stores/role.store';
import { NicknameStore } from '../../core/stores/nickname.store';
import { PresenceStore } from '../../core/stores/presence.store';
import { toAvatarStatus } from '../../core/models/presence.models';
import { Friend, PendingFriend } from '../../core/models/friend.models';
import { RoleService } from '../../core/services/role.service';
import { ProfileModalService } from '../../core/services/profile-modal.service';
import { ToastService } from '../../core/services/toast.service';
import { ContextMenuService } from '../../core/services/context-menu.service';
import { AuthService } from '../../core/services/auth.service';
import { buildUserMenu, UserMenuDeps } from '../shell/user-context-menu';
import { ContextMenuEntry } from '../../core/models/context-menu.models';
import { UiAvatar, ConfirmService } from '../../shared/ui';
import { NotificationBell } from '../shell/notification-bell/notification-bell';
import { UserProfilePopout } from '../shell/user-profile-popout/user-profile-popout';
import { MobileNavService } from '../../core/services/mobile-nav.service';

type FriendsTab = 'online' | 'all' | 'pending' | 'add';

@Component({
  selector: 'app-friends',
  standalone: true,
  imports: [FormsModule, UiAvatar, NotificationBell, OverlayModule, UserProfilePopout],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  templateUrl: './friends.html',
})
export class Friends {
  // Mobile: this page renders its own header, so it hosts its own drawer hamburger.
  protected readonly mobileNav = inject(MobileNavService);
  protected readonly friendStore = inject(FriendStore);
  protected readonly presenceStore = inject(PresenceStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly router = inject(Router);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly userMenuDeps: UserMenuDeps = {
    memberStore: inject(MemberStore),
    roleStore: inject(RoleStore),
    roleService: inject(RoleService),
    dmStore: this.dmStore,
    friendStore: this.friendStore,
    blockStore: inject(BlockStore),
    muteStore: inject(MuteStore),
    profileModal: inject(ProfileModalService),
    toast: inject(ToastService),
    router: this.router,
    auth: inject(AuthService),
    confirm: inject(ConfirmService),
  };

  /** Friend display name: the caller's private nickname ?? the friend's username. */
  protected friendName(id: string, username: string): string {
    return this.nicknameStore.nicknameOf(id) ?? username;
  }

  protected readonly tab = signal<FriendsTab>('online');

  // Add-friend form
  protected readonly addInput = signal('');
  protected readonly addBusy = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addSuccess = signal<string | null>(null);

  protected readonly tabs: { id: FriendsTab; label: string }[] = [
    { id: 'online', label: 'Online' },
    { id: 'all', label: 'All Friends' },
    { id: 'pending', label: 'Pending' },
    { id: 'add', label: 'Add Friend' },
  ];

  constructor() {
    // Load presence dots for the friend list whenever it changes.
    effect(() => {
      const ids = this.friendStore.friends().map((f) => f.id);
      if (ids.length) this.presenceStore.loadStatuses(ids);
    });
  }

  protected readonly onlineFriends = computed(() =>
    this.friendStore.friends().filter((f) => this.presenceStore.statusOf(f.id) !== 'offline'),
  );

  /** The list the Online / All Friends tabs render (they share the row markup). */
  protected readonly visibleFriends = computed(() =>
    this.tab() === 'online' ? this.onlineFriends() : this.friendStore.friends(),
  );

  avatarStatus(userId: string): ReturnType<typeof toAvatarStatus> {
    return toAvatarStatus(this.presenceStore.statusOf(userId));
  }

  /** Row subtitle: the friend's custom status when set, else their presence ("online"/"away"/…). */
  protected subtitle(userId: string): string {
    return this.presenceStore.statusMessageOf(userId) ?? this.presenceStore.statusOf(userId);
  }

  // --- profile popout (row click, anchored to the row) ---
  protected readonly profileFriend = signal<Friend | null>(null);
  protected readonly profileOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly profilePositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected openProfile(friend: Friend, origin: CdkOverlayOrigin): void {
    this.profileOrigin.set(origin);
    this.profileFriend.set(friend);
  }

  protected closeProfile(): void {
    this.profileFriend.set(null);
    this.profileOrigin.set(null);
  }

  /** Right-click a friend row → the shared user menu plus Remove Friend. */
  protected openFriendMenu(event: MouseEvent, friend: Friend): void {
    this.closeProfile();
    const entries = buildUserMenu(this.userMenuDeps, {
      userId: friend.id,
      guildId: null,
      username: friend.username,
    });
    entries.push(
      { separator: true },
      {
        label: 'Remove Friend',
        icon: 'fa-user-minus',
        danger: true,
        action: () => void this.remove(friend.id),
      },
    );
    this.contextMenu.open(event, entries);
  }

  /** Right-click a pending row → accept/ignore (incoming) or cancel (outgoing), plus the shared core. */
  protected openPendingMenu(event: MouseEvent, p: PendingFriend): void {
    const section: ContextMenuEntry[] =
      p.direction === 'incoming'
        ? [
            { label: 'Accept', icon: 'fa-check', action: () => void this.accept(p.id) },
            { label: 'Ignore', icon: 'fa-xmark', danger: true, action: () => void this.remove(p.id) },
          ]
        : [{ label: 'Cancel Request', icon: 'fa-xmark', danger: true, action: () => void this.remove(p.id) }];
    this.contextMenu.open(event, [
      ...section,
      { separator: true },
      ...buildUserMenu(this.userMenuDeps, { userId: p.id, guildId: null, username: p.username }),
    ]);
  }

  async accept(requesterId: string): Promise<void> {
    await this.friendStore.accept(requesterId).catch(() => {});
  }

  async remove(userId: string): Promise<void> {
    await this.friendStore.remove(userId);
  }

  async message(userId: string): Promise<void> {
    try {
      const dm = await this.dmStore.open(userId);
      this.router.navigate(['/app/dm', dm.channelId]);
    } catch {
      // ignore — blocked or transient
    }
  }

  async submitAdd(): Promise<void> {
    const username = this.addInput().trim();
    if (!username || this.addBusy()) return;
    this.addBusy.set(true);
    this.addError.set(null);
    this.addSuccess.set(null);
    try {
      await this.friendStore.sendRequest(username);
      this.addSuccess.set(`Friend request sent to ${username}.`);
      this.addInput.set('');
    } catch (err) {
      this.addError.set(this.errorMessage(err));
    } finally {
      this.addBusy.set(false);
    }
  }

  private errorMessage(err: unknown): string {
    const status = (err as { status?: number })?.status;
    if (status === 404) return "No user with that username.";
    if (status === 409) return 'You already have a pending request or are already friends.';
    if (status === 403) return 'Unable to send a request to this user.';
    if (status === 400) return "You can't add yourself.";
    return 'Could not send the request. Please try again.';
  }
}
