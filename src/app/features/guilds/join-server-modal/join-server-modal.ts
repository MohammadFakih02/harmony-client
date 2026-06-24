import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InviteService } from '../../../core/services/invite.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { InvitePreview } from '../../../core/models/invite.models';
import { extractInviteCode } from '../../../shared/util/invite-code';

/**
 * Paste an invite code (or link) → preview the server → join. On success the guild is added to
 * the store and we navigate into it. Rendered behind a parent `@if`, so it emits `close` rather
 * than owning its own visibility.
 */
@Component({
  selector: 'app-join-server-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './join-server-modal.html',
})
export class JoinServerModal {
  private readonly invites = inject(InviteService);
  private readonly guildStore = inject(GuildStore);
  private readonly router = inject(Router);

  readonly close = output<void>();

  protected readonly raw = signal('');
  protected readonly preview = signal<InvitePreview | null>(null);
  protected readonly loading = signal(false);
  protected readonly joining = signal(false);
  protected readonly error = signal('');

  async lookup(): Promise<void> {
    const code = extractInviteCode(this.raw());
    if (!code) return;
    this.loading.set(true);
    this.error.set('');
    this.preview.set(null);
    try {
      this.preview.set(await this.invites.preview(code));
    } catch (e: unknown) {
      this.error.set(this.messageFor(e, 'That invite is invalid or has expired.'));
    } finally {
      this.loading.set(false);
    }
  }

  async join(): Promise<void> {
    const p = this.preview();
    if (!p) return;
    this.joining.set(true);
    this.error.set('');
    try {
      const guild = await this.invites.join(p.code);
      this.guildStore.addGuild(guild);
      await this.enterGuild(guild.id);
    } catch (e: unknown) {
      // Already a member → just take them there; the guild is already in their list.
      if (this.statusOf(e) === 409) {
        await this.enterGuild(p.guildId);
        return;
      }
      this.error.set(this.messageFor(e, 'Could not join. The invite may have just expired.'));
    } finally {
      this.joining.set(false);
    }
  }

  private async enterGuild(guildId: string): Promise<void> {
    this.close.emit();
    await this.router.navigate(['/app/guilds', guildId]);
  }

  private statusOf(e: unknown): number | undefined {
    return typeof e === 'object' && e !== null && 'status' in e
      ? (e as { status?: number }).status
      : undefined;
  }

  private messageFor(e: unknown, fallback: string): string {
    return this.statusOf(e) === 410
      ? 'That invite has expired or been used up.'
      : this.statusOf(e) === 404
        ? 'That invite is invalid.'
        : fallback;
  }

  reset(): void {
    this.preview.set(null);
    this.error.set('');
    this.raw.set('');
  }
}
