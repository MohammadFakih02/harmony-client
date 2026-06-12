import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { GuildStore } from '../../../core/stores/guild.store';

@Component({
  selector: 'app-guild-sidebar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './guild-sidebar.html',
  styleUrl: './guild-sidebar.scss',
})
export class GuildSidebar {
  protected readonly auth = inject(AuthService);
  protected readonly guildStore = inject(GuildStore);
  private readonly router = inject(Router);

  protected readonly guildInitials = computed(() =>
    this.guildStore.guilds().reduce(
      (acc, g) => {
        acc[g.id] = g.name
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        return acc;
      },
      {} as Record<number, string>,
    ),
  );

  navigateToGuild(guildId: number): void {
    this.router.navigate(['/app/guilds', guildId]);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}
