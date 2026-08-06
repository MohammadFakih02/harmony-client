import { Injectable, signal } from '@angular/core';

/**
 * Decouples "open a user's full profile" from where the request comes from (the profile popout
 * lives in several places). The modal is hosted once in the shell and reads this target.
 */
@Injectable({ providedIn: 'root' })
export class ProfileModalService {
  readonly target = signal<{ userId: string; guildId: string | null } | null>(null);

  open(userId: string, guildId: string | null = null): void {
    this.target.set({ userId, guildId });
  }

  close(): void {
    this.target.set(null);
  }
}
