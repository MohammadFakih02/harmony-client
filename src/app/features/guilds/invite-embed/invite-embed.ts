import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InviteService } from '../../../core/services/invite.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { InvitePreview } from '../../../core/models/invite.models';

/**
 * Inline card rendered for an invite link found in a message (see {@link extractInviteCodes}).
 * Previews the code and offers a one-click Join — already-member (or a 409 on redeem) just
 * navigates into the guild; an invalid/expired code (404/410) shows a greyed "unavailable" card.
 * The `/invite/:code` landing page stays for out-of-app links; inside the app you only see this.
 */
@Component({
  selector: 'app-invite-embed',
  standalone: true,
  templateUrl: './invite-embed.html',
})
export class InviteEmbed implements OnInit {
  readonly code = input.required<string>();

  private readonly invites = inject(InviteService);
  private readonly guildStore = inject(GuildStore);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly preview = signal<InvitePreview | null>(null);
  protected readonly unavailable = signal(false); // invalid / expired / used up
  protected readonly joining = signal(false);

  /** True once we're already in the guild this invite points to — Join becomes "Joined". */
  protected readonly isMember = computed(() => {
    const p = this.preview();
    return !!p && this.guildStore.guilds().some((g) => g.id === p.guildId);
  });

  protected readonly initials = computed(() => {
    const name = this.preview()?.guildName ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  });

  async ngOnInit(): Promise<void> {
    try {
      this.preview.set(await this.invites.preview(this.code()));
    } catch {
      this.unavailable.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async accept(): Promise<void> {
    const p = this.preview();
    if (!p || this.joining()) return;

    if (this.isMember()) {
      this.router.navigate(['/app/guilds', p.guildId]);
      return;
    }

    this.joining.set(true);
    try {
      const guild = await this.invites.join(p.code);
      this.guildStore.addGuild(guild);
      await this.router.navigate(['/app/guilds', guild.id]);
    } catch (e: unknown) {
      // Already a member — the link was followed by someone who'd joined elsewhere meanwhile.
      if ((e as { status?: number })?.status === 409) {
        await this.router.navigate(['/app/guilds', p.guildId]);
        return;
      }
      // Anything else (expired between preview and click, etc.) → mark the card unavailable.
      this.unavailable.set(true);
    } finally {
      this.joining.set(false);
    }
  }
}
