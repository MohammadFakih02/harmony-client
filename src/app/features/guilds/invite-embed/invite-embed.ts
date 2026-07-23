import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InviteService } from '../../../core/services/invite.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { NotificationStore } from '../../../core/stores/notification.store';
import { InvitePreview } from '../../../core/models/invite.models';
import { ToastService } from '../../../core/services/toast.service';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * Inline card rendered for an invite link found in a message (see {@link extractInviteCodes}).
 * Previews the code (via the soft always-200 embed endpoint) and offers a one-click Join —
 * already-member (or a 409 on redeem) just navigates into the guild; an invalid/expired code
 * shows a greyed "unavailable" card.
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
  private readonly notificationStore = inject(NotificationStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

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
      // Soft endpoint: a dead code answers 200 {status} instead of 404/410, so old
      // messages full of expired invites don't spam the browser console.
      const res = await this.invites.previewEmbed(this.code());
      if (res.status === 'ok' && res.invite) this.preview.set(res.invite);
      else this.unavailable.set(true);
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
      // Joined — an outstanding guild_invite bell entry has served its purpose (the server clears it
      // too; this repaints the loaded row immediately).
      this.notificationStore.markGuildInviteRead(guild.id);
      await this.router.navigate(['/app/guilds', guild.id]);
    } catch (e: unknown) {
      // Already a member — the link was followed by someone who'd joined elsewhere meanwhile.
      if ((e as { status?: number })?.status === 409) {
        this.notificationStore.markGuildInviteRead(p.guildId);
        await this.router.navigate(['/app/guilds', p.guildId]);
        return;
      }
      // Banned (403) — tell them why rather than the misleading "unavailable" card.
      if ((e as { status?: number })?.status === 403) {
        this.toast.info(extractApiError(e), 'fa-ban');
        return;
      }
      // Anything else (expired between preview and click, etc.) → mark the card unavailable.
      this.unavailable.set(true);
    } finally {
      this.joining.set(false);
    }
  }
}
