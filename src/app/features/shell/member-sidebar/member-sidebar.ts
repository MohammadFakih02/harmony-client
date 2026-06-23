import { Component, inject, effect, computed } from '@angular/core';
import { UiAvatar } from '../../../shared/ui';
import { GuildStore } from '../../../core/stores/guild.store';
import { PresenceStore } from '../../../core/stores/presence.store';
import { MemberStore } from '../../../core/stores/member.store';
import { GuildMember } from '../../../core/models/member.models';
import { AvatarStatus, toAvatarStatus } from '../../../core/models/presence.models';

@Component({
  selector: 'app-member-sidebar',
  standalone: true,
  imports: [UiAvatar],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './member-sidebar.html',
})
export class MemberSidebar {
  protected readonly guildStore = inject(GuildStore);
  protected readonly presenceStore = inject(PresenceStore);
  protected readonly memberStore = inject(MemberStore);

  protected readonly members = computed<GuildMember[]>(() => {
    const guildId = this.guildStore.selectedGuildId();
    return guildId ? this.memberStore.membersOf(guildId) : [];
  });

  protected readonly sortedMembers = computed(() =>
    [...this.members()].sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return this.displayName(a).localeCompare(this.displayName(b));
    }),
  );

  constructor() {
    effect(() => {
      const guildId = this.guildStore.selectedGuildId();
      if (!guildId) return;
      this.memberStore.loadIfNeeded(guildId).then(() => {
        // Fetch current presence for these members; live changes arrive via SignalR.
        this.presenceStore.loadStatuses(this.memberStore.membersOf(guildId).map((m) => m.userId));
      });
    });
  }

  protected displayName(m: GuildMember): string {
    return m.nickname ?? m.username;
  }

  protected avatarStatus(userId: string): AvatarStatus {
    return toAvatarStatus(this.presenceStore.statusOf(userId));
  }
}
