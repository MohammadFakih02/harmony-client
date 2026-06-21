import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FriendStore } from '../../core/stores/friend.store';
import { DmStore } from '../../core/stores/dm.store';
import { PresenceStore } from '../../core/stores/presence.store';
import { toAvatarStatus } from '../../core/models/presence.models';
import { UiAvatar } from '../../shared/ui';

type FriendsTab = 'all' | 'pending' | 'add';

@Component({
  selector: 'app-friends',
  standalone: true,
  imports: [FormsModule, UiAvatar],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  templateUrl: './friends.html',
})
export class Friends {
  protected readonly friendStore = inject(FriendStore);
  protected readonly presenceStore = inject(PresenceStore);
  private readonly dmStore = inject(DmStore);
  private readonly router = inject(Router);

  protected readonly tab = signal<FriendsTab>('all');

  // Add-friend form
  protected readonly addInput = signal('');
  protected readonly addBusy = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly addSuccess = signal<string | null>(null);

  protected readonly tabs: { id: FriendsTab; label: string }[] = [
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

  avatarStatus(userId: string): ReturnType<typeof toAvatarStatus> {
    return toAvatarStatus(this.presenceStore.statusOf(userId));
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
