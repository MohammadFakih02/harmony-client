import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-guild-sidebar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './guild-sidebar.html',
  styleUrl: './guild-sidebar.scss',
})
export class GuildSidebar {
  private auth = inject(AuthService);
  private router = inject(Router);

  // Placeholder — replaced by NgRx store in Month 2
  guilds = [
    { id: '1', name: 'My Server', initials: 'MS' },
    { id: '2', name: 'Dev Team', initials: 'DT' },
  ];

  navigateToGuild(guildId: string): void {
    this.router.navigate(['/app/guilds', guildId]);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}
