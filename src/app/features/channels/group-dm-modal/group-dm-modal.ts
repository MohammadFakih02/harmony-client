import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FriendStore } from '../../../core/stores/friend.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { DirectMessageChannel } from '../../../core/models/direct-message.models';
import { Friend } from '../../../core/models/friend.models';
import { UiAvatar, UiModal } from '../../../shared/ui';

/**
 * Create a group DM from a multi-select of friends, or add people to an existing group.
 * Add mode is signalled by an `channelId` input; `excludeIds` hides friends already in the group.
 * Rendered behind a parent `@if`, so it loads on open and emits `close`.
 */
@Component({
  selector: 'app-group-dm-modal',
  standalone: true,
  imports: [FormsModule, UiAvatar, UiModal],
  templateUrl: './group-dm-modal.html',
})
export class GroupDmModal implements OnInit {
  private readonly friendStore = inject(FriendStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);

  /** When set, the modal adds the selected friends to this existing group instead of creating one. */
  readonly channelId = input<string | null>(null);
  /** User ids already in the group — filtered out of the pick list (add mode). */
  readonly excludeIds = input<string[]>([]);

  readonly close = output<void>();
  readonly created = output<DirectMessageChannel>();

  protected readonly search = signal('');
  protected readonly name = signal('');
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly isAddMode = computed(() => this.channelId() !== null);

  protected readonly candidates = computed(() => {
    const exclude = new Set(this.excludeIds());
    const q = this.search().trim().toLowerCase();
    return this.friendStore
      .friends()
      .filter((f) => !exclude.has(f.id))
      .filter((f) => !q || this.friendName(f).toLowerCase().includes(q));
  });

  // Create needs at least two others (a group); add needs at least one.
  protected readonly canConfirm = computed(() =>
    this.isAddMode() ? this.selected().size >= 1 : this.selected().size >= 2,
  );

  async ngOnInit(): Promise<void> {
    if (this.friendStore.friends().length === 0) await this.friendStore.load();
  }

  protected friendName(f: Friend): string {
    return this.nicknameStore.nicknameOf(f.id) ?? f.username;
  }

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  protected async confirm(): Promise<void> {
    if (!this.canConfirm() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const ids = [...this.selected()];
    try {
      const channelId = this.channelId();
      if (channelId) {
        for (const id of ids) await this.dmStore.addParticipant(channelId, id);
      } else {
        const name = this.name().trim();
        const dm = await this.dmStore.createGroup(name || null, ids);
        this.created.emit(dm);
      }
      this.close.emit();
    } catch {
      this.error.set('Something went wrong. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
