import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileStore } from '../../../core/stores/profile.store';
import { UiAvatar, UiButton, UiProfileBanner } from '../../../shared/ui';

/** My Account — identity summary + log out. Profile editing (avatar/banner/bio/DOB/colour) lives
 *  in the Profile pane; the Edit Profile button switches to it inline. Credential changes
 *  (password/email/username) are a separate future slice. */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar, UiButton, UiProfileBanner],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">My Account</h2>

    @if (auth.currentUser(); as me) {
    <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden">
      <ui-profile-banner
        class="h-24"
        [bannerKey]="profile()?.bannerKey ?? null"
        [bannerColor]="profile()?.bannerColor ?? null"
        [alt]="me.username"
      />

      <div class="px-4 pb-4">
        <!-- Avatar overlapping the banner + Edit Profile on the card -->
        <div class="relative z-10 flex items-end justify-between -mt-10">
          <div class="inline-block rounded-full ring-[5px] ring-surface-2 bg-surface-2">
            <ui-avatar [src]="me.avatarKey" [alt]="me.username" size="2xl" ringClass="border-surface-2" />
          </div>
          <button
            type="button"
            class="mb-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-micro inline-flex items-center gap-1.5 shrink-0"
            (click)="openProfile.emit()"
          >
            <i class="fas fa-pen text-2xs"></i> Edit Profile
          </button>
        </div>

        <p class="mt-2.5 text-lg font-bold text-primary leading-tight truncate">{{ me.username }}</p>

        <div class="mt-3 rounded-lg bg-surface border border-border-subtle divide-y divide-border-subtle">
          <div class="px-3.5 py-3 min-w-0">
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Username</p>
            <p class="text-sm text-primary mt-0.5 truncate">{{ me.username }}</p>
          </div>
          <div class="px-3.5 py-3 min-w-0">
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Email</p>
            <p class="text-sm text-primary mt-0.5 truncate">{{ me.email }}</p>
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
export class AccountSettings implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly profileStore = inject(ProfileStore);

  /** Asks the settings shell to switch to the Profile pane (inline — no modal round-trip). */
  readonly openProfile = output<void>();

  protected readonly profile = computed(() => {
    const id = this.auth.currentUser()?.id;
    return id ? this.profileStore.profileOf(id) : undefined;
  });

  ngOnInit(): void {
    const id = this.auth.currentUser()?.id;
    if (id) void this.profileStore.refresh(id);
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
