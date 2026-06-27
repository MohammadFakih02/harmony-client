import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InviteService } from '../../../core/services/invite.service';
import { MessageService } from '../../../core/services/message.service';
import { FriendStore } from '../../../core/stores/friend.store';
import { DmStore } from '../../../core/stores/dm.store';
import { Invite } from '../../../core/models/invite.models';
import { Friend } from '../../../core/models/friend.models';
import { UiAvatar } from '../../../shared/ui';

interface ExpiryOption {
  label: string;
  seconds: number | null;
}
interface MaxUsesOption {
  label: string;
  value: number | null;
}

/**
 * Server invite management: pick expiry + max-uses, generate a code, copy it, and see/revoke the
 * guild's existing invites. Rendered behind a parent `@if`, so it loads on open and emits `close`.
 */
@Component({
  selector: 'app-invite-people-modal',
  standalone: true,
  imports: [FormsModule, UiAvatar],
  templateUrl: './invite-people-modal.html',
})
export class InvitePeopleModal implements OnInit {
  private readonly invites = inject(InviteService);
  private readonly messages = inject(MessageService);
  protected readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);

  readonly guildId = input.required<string>();
  readonly close = output<void>();

  protected readonly list = signal<Invite[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  protected readonly copiedCode = signal<string | null>(null);

  protected readonly expiryOptions: ExpiryOption[] = [
    { label: '30 minutes', seconds: 1800 },
    { label: '1 hour', seconds: 3600 },
    { label: '6 hours', seconds: 21600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'Never', seconds: null },
  ];
  protected readonly maxUsesOptions: MaxUsesOption[] = [
    { label: 'No limit', value: null },
    { label: '1 use', value: 1 },
    { label: '5 uses', value: 5 },
    { label: '10 uses', value: 10 },
    { label: '25 uses', value: 25 },
  ];

  protected readonly expiry = signal<number | null>(604800); // default: 7 days
  protected readonly maxUses = signal<number | null>(null); // default: no limit

  // --- Invite a friend (mint a personal invite + DM it as a link the recipient sees as a card) ---
  protected readonly friendQuery = signal('');
  protected readonly invitingFriend = signal<Friend | null>(null); // non-null → the confirm step
  protected readonly friendExpiry = signal<number | null>(604800); // confirm default: 7 days
  protected readonly friendMaxUses = signal<number | null>(1); // confirm default: 1 use
  protected readonly sending = signal(false);
  protected readonly invitedFriendIds = signal<Set<string>>(new Set()); // show "Sent" per friend

  protected readonly filteredFriends = computed(() => {
    const q = this.friendQuery().trim().toLowerCase();
    const friends = this.friendStore.friends();
    return q ? friends.filter((f) => f.username.toLowerCase().includes(q)) : friends;
  });

  async ngOnInit(): Promise<void> {
    this.friendStore.load(); // ensure the friend list is available (cheap; shell usually warmed it)
    try {
      this.list.set(await this.invites.listInvites(this.guildId()));
    } catch {
      this.error.set('Could not load existing invites.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Opens the send-side confirm step for a friend, reset to the 7-day / 1-use defaults. */
  openFriendInvite(friend: Friend): void {
    this.friendExpiry.set(604800);
    this.friendMaxUses.set(1);
    this.error.set('');
    this.invitingFriend.set(friend);
  }

  cancelFriendInvite(): void {
    this.invitingFriend.set(null);
  }

  /** Mints an invite with the confirmed options and DMs it to the friend as a shareable link. */
  async sendFriendInvite(): Promise<void> {
    const friend = this.invitingFriend();
    if (!friend || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      const invite = await this.invites.createInvite(this.guildId(), {
        maxUses: this.friendMaxUses() ?? undefined,
        expiresInSeconds: this.friendExpiry() ?? undefined,
      });
      const dm = await this.dmStore.open(friend.id);
      const link = `${window.location.origin}/invite/${invite.code}`;
      await this.messages.sendMessage(null, dm.channelId, link);
      this.invitedFriendIds.set(new Set(this.invitedFriendIds()).add(friend.id));
      this.invitingFriend.set(null);
    } catch {
      this.error.set('Could not send the invite.');
    } finally {
      this.sending.set(false);
    }
  }

  async generate(): Promise<void> {
    this.creating.set(true);
    this.error.set('');
    try {
      const invite = await this.invites.createInvite(this.guildId(), {
        maxUses: this.maxUses() ?? undefined,
        expiresInSeconds: this.expiry() ?? undefined,
      });
      this.list.set([invite, ...this.list()]);
      await this.copy(invite.code);
    } catch {
      this.error.set('Could not create an invite.');
    } finally {
      this.creating.set(false);
    }
  }

  async copy(code: string): Promise<void> {
    try {
      const link = `${window.location.origin}/invite/${code}`;
      await navigator.clipboard.writeText(link);
      this.copiedCode.set(code);
      setTimeout(() => {
        if (this.copiedCode() === code) this.copiedCode.set(null);
      }, 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — non-fatal; the code is still visible.
    }
  }

  async revoke(code: string): Promise<void> {
    const previous = this.list();
    this.list.set(previous.filter((i) => i.code !== code)); // optimistic
    try {
      await this.invites.deleteInvite(this.guildId(), code);
    } catch {
      this.list.set(previous); // revert on failure
      this.error.set('Could not revoke that invite.');
    }
  }

  protected usesLabel(invite: Invite): string {
    return invite.maxUses === null
      ? `${invite.useCount} uses`
      : `${invite.useCount} / ${invite.maxUses} uses`;
  }

  protected expiryLabel(invite: Invite): string {
    if (invite.expiresAt === null) return 'Never expires';
    const ms = invite.expiresAt - Date.now();
    if (ms <= 0) return 'Expired';
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 24) return `Expires in ${Math.floor(hours / 24)}d`;
    if (hours >= 1) return `Expires in ${hours}h`;
    return `Expires in ${Math.max(1, Math.floor(ms / 60_000))}m`;
  }
}
