import { Component, inject, effect, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UiAvatar } from '../../../shared/ui';
import { GuildStore } from '../../../core/stores/guild.store';
import { environment } from '../../../../environments/environment';

interface GuildMember {
  userId: string;
  username: string;
  discriminator: string;
  nickname: string | null;
  avatarKey: string | null;
  isOwner: boolean;
  joinedAt: number;
}

@Component({
  selector: 'app-member-sidebar',
  standalone: true,
  imports: [UiAvatar],
  host: { class: 'flex flex-col h-full w-full overflow-hidden' },
  templateUrl: './member-sidebar.html',
})
export class MemberSidebar {
  protected readonly guildStore = inject(GuildStore);
  private readonly http = inject(HttpClient);

  protected readonly members = signal<GuildMember[]>([]);
  protected readonly loading = signal(false);

  protected readonly sortedMembers = computed(() =>
    [...this.members()].sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return this.displayName(a).localeCompare(this.displayName(b));
    }),
  );

  constructor() {
    effect(() => {
      const guildId = this.guildStore.selectedGuildId();
      if (guildId) this.loadMembers(guildId);
      else this.members.set([]);
    });
  }

  private async loadMembers(guildId: string): Promise<void> {
    this.loading.set(true);
    try {
      const raw = await firstValueFrom(
        this.http.get<GuildMember[]>(`${environment.apiUrl}/guilds/${guildId}/members`),
      );
      this.members.set(raw);
    } catch {
      this.members.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected displayName(m: GuildMember): string {
    return m.nickname ?? m.username;
  }
}
