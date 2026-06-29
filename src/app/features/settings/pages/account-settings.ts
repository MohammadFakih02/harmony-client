import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { UiAvatar, UiButton } from '../../../shared/ui';

/** My Account — a read-only identity summary plus Edit Profile + Log Out.
 *  Credential changes (password/email/username) are a separate future slice. */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar, UiButton],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">My Account</h2>

    @if (auth.currentUser(); as me) {
    <div class="rounded-lg bg-surface-2 overflow-hidden">
      <div class="h-20 bg-accent/30"></div>
      <div class="px-4 pb-4 -mt-8">
        <div class="inline-block rounded-full ring-[6px] ring-surface-2">
          <ui-avatar [src]="me.avatarKey" [alt]="me.username" size="xl" ringClass="border-surface-2" />
        </div>

        <div class="mt-3 rounded-lg bg-surface p-4 space-y-4">
          <div>
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Username</p>
            <p class="text-sm text-primary mt-0.5">{{ me.username }}</p>
          </div>
          <div>
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Email</p>
            <p class="text-sm text-primary mt-0.5">{{ me.email }}</p>
          </div>
          <div class="pt-1">
            <ui-button variant="ghost" size="sm" (click)="editProfile()">Edit Profile</ui-button>
          </div>
        </div>
      </div>
    </div>

    <div class="h-px bg-border-subtle my-6"></div>

    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold text-primary">Log out</p>
        <p class="text-xs text-muted mt-0.5">End your session on this device.</p>
      </div>
      <ui-button variant="danger" size="sm" (click)="logout()">Log Out</ui-button>
    </div>
    }
  `,
})
export class AccountSettings {
  protected readonly auth = inject(AuthService);
  private readonly profileModal = inject(ProfileModalService);

  protected editProfile(): void {
    const id = this.auth.currentUser()?.id;
    if (id) this.profileModal.open(id);
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
