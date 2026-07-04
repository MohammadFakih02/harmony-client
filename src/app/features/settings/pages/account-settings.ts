import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { PresenceStore } from '../../../core/stores/presence.store';
import { toAvatarStatus } from '../../../core/models/presence.models';
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
    <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden">
      <div class="h-24 profile-banner"></div>
      <div class="px-4 pb-4">
        <!-- Identity row: avatar overlapping the banner + Edit Profile on the right -->
        <div class="relative z-10 flex items-end justify-between -mt-10">
          <div class="inline-block rounded-full ring-[6px] ring-surface-2 bg-surface-2">
            <ui-avatar
              [src]="me.avatarKey"
              [alt]="me.username"
              size="2xl"
              [status]="myStatus()"
              ringClass="border-surface-2"
            />
          </div>
          <ui-button variant="ghost" size="sm" (click)="editProfile()">
            <i class="fas fa-pen text-xs mr-1.5"></i> Edit Profile
          </ui-button>
        </div>

        <p class="mt-2.5 text-lg font-bold text-primary leading-tight truncate">{{ me.username }}</p>

        <!-- Details card -->
        <div class="mt-3 rounded-lg bg-surface p-4 flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-2xs font-bold uppercase tracking-wider text-faint">Username</p>
              <p class="text-sm text-primary mt-0.5 truncate">{{ me.username }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-2xs font-bold uppercase tracking-wider text-faint">Email</p>
              <p class="text-sm text-primary mt-0.5 truncate">
                {{ revealEmail() ? me.email : maskedEmail() }}
              </p>
            </div>
            <button
              type="button"
              class="text-xs text-accent hover:underline shrink-0"
              (click)="revealEmail.set(!revealEmail())"
            >
              {{ revealEmail() ? 'Hide' : 'Reveal' }}
            </button>
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
  private readonly presenceStore = inject(PresenceStore);

  protected readonly revealEmail = signal(false);

  protected readonly myStatus = computed(() => toAvatarStatus(this.presenceStore.myStatus()));

  /** "m•••@gmail.com" — enough to recognise the account without shoulder-surfing it. */
  protected readonly maskedEmail = computed(() => {
    const email = this.auth.currentUser()?.email ?? '';
    const at = email.indexOf('@');
    if (at <= 1) return email;
    return `${email[0]}${'•'.repeat(Math.min(at - 1, 8))}${email.slice(at)}`;
  });

  protected editProfile(): void {
    const id = this.auth.currentUser()?.id;
    if (id) this.profileModal.open(id);
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
