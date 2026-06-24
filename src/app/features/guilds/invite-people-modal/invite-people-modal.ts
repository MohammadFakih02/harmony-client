import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InviteService } from '../../../core/services/invite.service';
import { Invite } from '../../../core/models/invite.models';

interface ExpiryOption {
  label: string;
  seconds: number | null;
}
interface MaxUsesOption {
  label: string;
  value: number | null;
}

/**
 * Server invite management: pick expiry + max-uses, generate a code, copy it, and see/revoke the
 * guild's existing invites. Rendered behind a parent `@if`, so it loads on open and emits `close`.
 */
@Component({
  selector: 'app-invite-people-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './invite-people-modal.html',
})
export class InvitePeopleModal implements OnInit {
  private readonly invites = inject(InviteService);

  readonly guildId = input.required<string>();
  readonly close = output<void>();

  protected readonly list = signal<Invite[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  protected readonly copiedCode = signal<string | null>(null);

  protected readonly expiryOptions: ExpiryOption[] = [
    { label: '30 minutes', seconds: 1800 },
    { label: '1 hour', seconds: 3600 },
    { label: '6 hours', seconds: 21600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'Never', seconds: null },
  ];
  protected readonly maxUsesOptions: MaxUsesOption[] = [
    { label: 'No limit', value: null },
    { label: '1 use', value: 1 },
    { label: '5 uses', value: 5 },
    { label: '10 uses', value: 10 },
    { label: '25 uses', value: 25 },
  ];

  protected readonly expiry = signal<number | null>(604800); // default: 7 days
  protected readonly maxUses = signal<number | null>(null); // default: no limit

  async ngOnInit(): Promise<void> {
    try {
      this.list.set(await this.invites.listInvites(this.guildId()));
    } catch {
      this.error.set('Could not load existing invites.');
    } finally {
      this.loading.set(false);
    }
  }

  async generate(): Promise<void> {
    this.creating.set(true);
    this.error.set('');
    try {
      const invite = await this.invites.createInvite(this.guildId(), {
        maxUses: this.maxUses() ?? undefined,
        expiresInSeconds: this.expiry() ?? undefined,
      });
      this.list.set([invite, ...this.list()]);
      await this.copy(invite.code);
    } catch {
      this.error.set('Could not create an invite.');
    } finally {
      this.creating.set(false);
    }
  }

  async copy(code: string): Promise<void> {
    try {
      const link = `${window.location.origin}/invite/${code}`;
      await navigator.clipboard.writeText(link);
      this.copiedCode.set(code);
      setTimeout(() => {
        if (this.copiedCode() === code) this.copiedCode.set(null);
      }, 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — non-fatal; the code is still visible.
    }
  }

  async revoke(code: string): Promise<void> {
    const previous = this.list();
    this.list.set(previous.filter((i) => i.code !== code)); // optimistic
    try {
      await this.invites.deleteInvite(this.guildId(), code);
    } catch {
      this.list.set(previous); // revert on failure
      this.error.set('Could not revoke that invite.');
    }
  }

  protected usesLabel(invite: Invite): string {
    return invite.maxUses === null
      ? `${invite.useCount} uses`
      : `${invite.useCount} / ${invite.maxUses} uses`;
  }

  protected expiryLabel(invite: Invite): string {
    if (invite.expiresAt === null) return 'Never expires';
    const ms = invite.expiresAt - Date.now();
    if (ms <= 0) return 'Expired';
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 24) return `Expires in ${Math.floor(hours / 24)}d`;
    if (hours >= 1) return `Expires in ${hours}h`;
    return `Expires in ${Math.max(1, Math.floor(ms / 60_000))}m`;
  }
}
