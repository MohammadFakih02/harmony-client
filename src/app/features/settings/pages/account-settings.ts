import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { UserService } from '../../../core/services/user.service';
import { UiAvatar, UiButton } from '../../../shared/ui';
import { publicFileUrl } from '../../../shared/util/public-file-url';

/** My Account — identity summary, the profile banner colour picker, Edit Profile + Log Out.
 *  Credential changes (password/email/username) are a separate future slice. The banner colour is
 *  a user-picked profile colour (PATCH /me) — independent of theme/role colours; a banner image
 *  (uploaded via Edit Profile) covers it when set. */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAvatar, UiButton],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">My Account</h2>

    @if (auth.currentUser(); as me) {
    <div class="rounded-lg bg-surface-2 overflow-hidden">
      <div class="h-20" [style.background-color]="headerColor()">
        @if (bannerImageUrl(); as banner) {
        <img [src]="banner" alt="" class="w-full h-full object-cover" />
        }
      </div>
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

          <div>
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Banner Colour</p>
            <div class="mt-1.5 flex items-center gap-2">
              <input
                type="color"
                class="w-9 h-7 rounded-md bg-surface-2 border border-border-subtle cursor-pointer disabled:opacity-50"
                [value]="bannerColor() || '#5865f2'"
                [disabled]="savingColor()"
                (change)="pickColor($any($event.target).value)"
              />
              @if (bannerColor()) {
              <span class="text-xs text-muted">{{ bannerColor() }}</span>
              <button
                type="button"
                class="px-2 py-1 rounded-md text-xs text-muted hover:text-primary hover:bg-surface-2 transition-micro"
                [disabled]="savingColor()"
                (click)="pickColor('')"
              >
                Clear
              </button>
              } @else {
              <span class="text-xs text-faint">Default</span>
              }
            </div>
            <p class="text-2xs text-faint mt-1">
              Your profile banner colour. A banner image (set via Edit Profile) covers it.
            </p>
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
export class AccountSettings implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly profileModal = inject(ProfileModalService);
  private readonly userService = inject(UserService);

  protected readonly bannerColor = signal<string | null>(null);
  protected readonly bannerImageUrl = signal<string | null>(null);
  protected readonly savingColor = signal(false);

  /** Card-strip colour: the picked banner colour, else a neutral accent-ish default. */
  protected headerColor(): string {
    return this.bannerColor() ?? 'color-mix(in srgb, var(--color-accent) 30%, transparent)';
  }

  ngOnInit(): void {
    void this.userService.getMe().then((me) => {
      this.bannerColor.set(me.bannerColor);
      this.bannerImageUrl.set(publicFileUrl(me.bannerKey));
    }).catch(() => {
      // fail-open — the picker just starts from the default
    });
  }

  protected async pickColor(value: string): Promise<void> {
    if (this.savingColor()) return;
    const previous = this.bannerColor();
    this.savingColor.set(true);
    this.bannerColor.set(value || null);
    try {
      await this.userService.updateProfile({ bannerColor: value });
    } catch {
      this.bannerColor.set(previous); // revert on failure
    } finally {
      this.savingColor.set(false);
    }
  }

  protected editProfile(): void {
    const id = this.auth.currentUser()?.id;
    if (id) this.profileModal.open(id);
  }

  protected logout(): void {
    void this.auth.logout();
  }
}
