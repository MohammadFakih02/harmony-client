import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { InviteService } from '../../../core/services/invite.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { InvitePreview } from '../../../core/models/invite.models';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Landing page for a shared invite link (`/invite/:code`). Public route: if the visitor isn't
 * logged in, it sends them to login with a returnUrl so the link survives the round trip;
 * otherwise it previews the server and lets them accept. An already-member (409) is taken
 * straight into the guild.
 */
@Component({
  selector: 'app-invite-landing',
  standalone: true,
  templateUrl: './invite-landing.html',
})
export class InviteLanding implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly invites = inject(InviteService);
  private readonly guildStore = inject(GuildStore);

  protected code = '';
  protected readonly loading = signal(true);
  protected readonly authed = signal(false);
  protected readonly preview = signal<InvitePreview | null>(null);
  protected readonly error = signal('');
  protected readonly joining = signal(false);

  async ngOnInit(): Promise<void> {
    this.code = this.route.snapshot.paramMap.get('code') ?? '';
    if (!this.code) {
      this.error.set('This invite link is invalid.');
      this.loading.set(false);
      return;
    }

    const ok = this.auth.isAuthenticated() || (await this.auth.tryRestoreSession());
    this.authed.set(ok);
    if (!ok) {
      this.loading.set(false);
      return;
    }

    try {
      this.preview.set(await this.invites.preview(this.code));
    } catch (e: unknown) {
      this.error.set(extractApiError(e));
    } finally {
      this.loading.set(false);
    }
  }

  login(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: `/invite/${this.code}` } });
  }

  async join(): Promise<void> {
    const p = this.preview();
    if (!p) return;
    this.joining.set(true);
    this.error.set('');
    try {
      const guild = await this.invites.join(p.code);
      this.guildStore.addGuild(guild);
      await this.router.navigate(['/app/guilds', guild.id]);
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 409) {
        await this.router.navigate(['/app/guilds', p.guildId]);
        return;
      }
      this.error.set(extractApiError(e));
    } finally {
      this.joining.set(false);
    }
  }

  cancel(): void {
    this.router.navigate(['/app']);
  }
}
