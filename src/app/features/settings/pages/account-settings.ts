import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { runResendCooldown } from '../../../shared/util/resend-cooldown';
import { ConfirmService, ImageCropperModal, UiAvatar, UiButton, UiProfileBanner } from '../../../shared/ui';
import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { FileService } from '../../../core/services/file.service';
import { ToastService } from '../../../core/services/toast.service';
import { ProfileStore } from '../../../core/stores/profile.store';
import { MyEditableProfile } from '../../../core/models/user.models';
import { Enable2faModal } from '../ui/enable-2fa-modal';
import { ChangePasswordModal } from '../ui/change-password-modal';
import { ChangeEmailModal } from '../ui/change-email-modal';
import { ChangeUsernameModal } from '../ui/change-username-modal';
import { extractApiError } from '../../../shared/util/api-error';

/**
 * My Account — the single pane for your identity: profile editing (avatar/banner upload apply
 * immediately; bio / date of birth / banner colour save with the dirty-gated Save bar), the
 * account credentials block (password/email/username changes, each password-gated — a
 * passwordless Google-only account sees "Set a password first" until it does), and Log Out.
 * Replaces the old separate Profile pane (the two showed the same card twice).
 */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    UiAvatar,
    UiButton,
    UiProfileBanner,
    ImageCropperModal,
    Enable2faModal,
    ChangePasswordModal,
    ChangeEmailModal,
    ChangeUsernameModal,
  ],
  template: `
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">My Account</h2>
      <p class="text-sm text-muted mt-1.5">Your identity, credentials, and account security.</p>
    </header>

    @if (me(); as me) {
    <!-- ============ PROFILE ============ -->
    <section class="rounded-2xl bg-surface-2 border border-border-subtle overflow-hidden">
      <!-- Banner with inline edit controls (live-previews the colour draft when no image) -->
      <ui-profile-banner
        class="h-32"
        [bannerKey]="me.bannerKey"
        [bannerColor]="colorDraft() || null"
        [alt]="me.username"
      >
        <div class="absolute bottom-2.5 right-2.5 flex gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-black/50 text-white hover:bg-black/70 disabled:opacity-50 transition-micro backdrop-blur-sm"
            [disabled]="uploading() !== null"
            (click)="bannerInput.click()"
          >
            @if (uploading() === 'banner') {<i class="spinner-brand"></i>}
            @else {<i class="fas fa-image"></i>}
            Change Banner
          </button>
          @if (me.bannerKey) {
          <button
            type="button"
            class="inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs bg-black/50 text-white/80 hover:bg-black/70 hover:text-white disabled:opacity-50 transition-micro backdrop-blur-sm"
            [disabled]="uploading() !== null"
            aria-label="Remove banner"
            title="Remove banner"
            (click)="removeAsset('banner')"
          >
            <i class="fas fa-trash-can"></i>
          </button>
          }
        </div>
      </ui-profile-banner>

      <div class="px-5 pb-5">
        <!-- Identity row: avatar overlaps the banner, name beside it -->
        <div class="flex items-end gap-4 -mt-12">
          <div class="relative rounded-full p-1.5 bg-surface-2 shrink-0">
            <ui-avatar [src]="me.avatarKey" [alt]="me.username" size="2xl" ringClass="border-surface-2" />
            <button
              type="button"
              class="absolute inset-1.5 rounded-full bg-black/45 text-white opacity-0 hover:opacity-100 focus-visible:opacity-100 flex items-center justify-center transition-micro"
              [disabled]="uploading() !== null"
              aria-label="Change avatar"
              (click)="avatarInput.click()"
            >
              @if (uploading() === 'avatar') {
              <i class="spinner-brand"></i>
              } @else {
              <i class="fas fa-camera"></i>
              }
            </button>
            @if (me.avatarKey) {
            <button
              type="button"
              class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-danger text-white text-2xs flex items-center justify-center shadow-sm hover:brightness-110 transition-micro"
              [disabled]="uploading() !== null"
              aria-label="Remove avatar"
              (click)="removeAsset('avatar')"
            >
              <i class="fas fa-xmark"></i>
            </button>
            }
          </div>

          <div class="flex-1 min-w-0 pb-1">
            <p class="font-display text-xl font-bold text-primary leading-tight truncate tracking-[-0.01em]">
              {{ me.username }}
            </p>
            <p class="text-xs text-faint mt-0.5">This is how others see you.</p>
          </div>
        </div>

        <!-- Editable fields -->
        <div class="mt-5 pt-5 border-t border-border-subtle flex flex-col gap-5">
          <div>
            <div class="flex items-baseline justify-between">
              <label class="text-2xs font-bold uppercase tracking-wider text-faint">About Me</label>
              <span class="text-2xs text-faint tabular-nums">{{ bioDraft().length }}/500</span>
            </div>
            <textarea
              rows="4"
              maxlength="500"
              placeholder="Tell people about yourself…"
              class="mt-1.5 w-full px-3 py-2.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro resize-none"
              [ngModel]="bioDraft()"
              (ngModelChange)="bioDraft.set($event)"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div>
              <label class="text-2xs font-bold uppercase tracking-wider text-faint">Date of Birth</label>
              <input
                type="date"
                [max]="today"
                class="mt-1.5 w-full px-3 py-2.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
                [ngModel]="dobDraft()"
                (ngModelChange)="dobDraft.set($event)"
              />
              <p class="text-2xs text-faint mt-1.5">Others see your age, never your birthday.</p>
            </div>

            @if (!me.bannerKey) {
            <div>
              <label class="text-2xs font-bold uppercase tracking-wider text-faint">Banner Colour</label>
              <div class="mt-1.5 flex items-center gap-2 h-[42px]">
                <label class="relative w-10 h-10 rounded-lg overflow-hidden border border-border-subtle cursor-pointer shrink-0">
                  <span class="absolute inset-0" [style.background]="colorDraft() || 'var(--color-accent)'"></span>
                  <input
                    type="color"
                    class="absolute inset-0 opacity-0 cursor-pointer"
                    [value]="colorDraft() || '#5865f2'"
                    (input)="colorDraft.set($any($event.target).value)"
                  />
                </label>
                @if (colorDraft()) {
                <span class="text-xs text-muted tabular-nums flex-1 truncate">{{ colorDraft() }}</span>
                <button
                  type="button"
                  class="px-2 py-1 rounded-md text-xs text-muted hover:text-primary hover:bg-surface transition-micro shrink-0"
                  (click)="colorDraft.set('')"
                >
                  Clear
                </button>
                } @else {
                <span class="text-xs text-faint flex-1">Accent default</span>
                }
              </div>
              <p class="text-2xs text-faint mt-1.5">Shown behind your avatar until you add a banner image.</p>
            </div>
            }
          </div>

          @if (error()) {
          <p class="text-xs text-danger">{{ error() }}</p>
          }
        </div>
      </div>

      <!-- Save bar — appears only when there are unsaved changes -->
      @if (dirty()) {
      <div class="flex items-center gap-2 border-t border-border-subtle bg-surface/40 px-5 py-3 animate-fade-in">
        <i class="fas fa-circle-dot text-2xs text-accent"></i>
        <span class="text-xs text-muted flex-1">You have unsaved changes.</span>
        <button
          type="button"
          class="px-3 h-8 rounded-lg text-xs font-medium text-muted hover:text-primary hover:bg-surface transition-micro"
          (click)="reset()"
        >
          Reset
        </button>
        <button
          type="button"
          class="px-4 h-8 rounded-lg text-xs font-semibold bg-accent text-accent-contrast hover:bg-accent-hover hover:shadow-accent-glow disabled:opacity-50 transition-all"
          [disabled]="saving()"
          (click)="save()"
        >
          {{ saving() ? 'Saving…' : 'Save Changes' }}
        </button>
      </div>
      }
    </section>

    <!-- ============ ACCOUNT & SECURITY ============ -->
    <p class="mt-8 mb-2.5 px-1 text-2xs font-bold uppercase tracking-wider text-faint">Account &amp; Security</p>
    <section class="rounded-2xl bg-surface-2 border border-border-subtle divide-y divide-border-subtle overflow-hidden">
      <!-- Username -->
      <div class="flex items-center gap-3.5 px-4 py-3.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-faint">
          <i class="fas fa-at"></i>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-2xs font-bold uppercase tracking-wider text-faint">Username</p>
          <p class="text-sm text-primary mt-0.5 truncate">{{ me.username }}</p>
        </div>
        <ui-button
          variant="ghost"
          size="sm"
          [disabled]="!hasPassword()"
          [title]="!hasPassword() ? 'Set a password first' : ''"
          (click)="showUsernameModal.set(true)"
        >
          Change
        </ui-button>
      </div>

      <!-- Email (+ unverified nag) -->
      <div class="px-4 py-3.5">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-faint">
            <i class="fas fa-envelope"></i>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-bold uppercase tracking-wider text-faint">Email</p>
            <p class="text-sm text-primary mt-0.5 truncate">{{ email() }}</p>
          </div>
          <ui-button
            variant="ghost"
            size="sm"
            [disabled]="!hasPassword()"
            [title]="!hasPassword() ? 'Set a password first' : ''"
            (click)="showEmailModal.set(true)"
          >
            Change
          </ui-button>
        </div>
        @if (!emailVerified()) {
        <div class="mt-3 ml-[3.125rem] flex items-center gap-2 rounded-lg bg-warning-muted border border-warning/30 px-2.5 py-2">
          <i class="fas fa-triangle-exclamation text-warning text-xs"></i>
          <span class="text-xs text-muted flex-1">Your email isn't verified yet.</span>
          <button
            type="button"
            class="px-2.5 py-1 rounded-md text-xs font-semibold bg-warning/20 text-warning hover:bg-warning/30 disabled:opacity-50 transition-micro"
            [disabled]="resending() || resendCooldown() > 0"
            (click)="resendVerification()"
          >
            @if (resendCooldown() > 0) { Resend ({{ resendCooldown() }}s) }
            @else if (resending()) { Sending… }
            @else { Resend Email }
          </button>
        </div>
        }
      </div>

      <!-- Password -->
      <div class="flex items-center gap-3.5 px-4 py-3.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-faint">
          <i class="fas fa-key"></i>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-2xs font-bold uppercase tracking-wider text-faint">Password</p>
          @if (!hasPassword()) {
          <p class="text-xs text-muted mt-0.5">
            Signed in with Google — set a password to change your email or username.
          </p>
          } @else {
          <p class="text-sm text-primary mt-0.5 tracking-widest">••••••••</p>
          }
        </div>
        @if (!hasPassword()) {
        <ui-button variant="primary" size="sm" (click)="showPasswordModal.set(true)">Set Password</ui-button>
        } @else {
        <ui-button variant="ghost" size="sm" (click)="showPasswordModal.set(true)">Change</ui-button>
        }
      </div>

      <!-- Two-factor authentication -->
      <div class="px-4 py-3.5">
        <div class="flex items-center gap-3.5">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            [class.bg-surface]="!twoFactorEnabled()"
            [class.text-faint]="!twoFactorEnabled()"
            [class.bg-success-muted]="twoFactorEnabled()"
            [class.text-success]="twoFactorEnabled()"
          >
            <i class="fas fa-shield-halved"></i>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-primary">Two-Factor Authentication</p>
            <p class="text-xs text-muted mt-0.5">
              @if (twoFactorEnabled()) { Enabled — we'll email a code at login. }
              @else { Adds an emailed code to your login, on top of your password. }
            </p>
          </div>
          @if (!twoFactorEnabled()) {
          <ui-button variant="primary" size="sm" (click)="showEnableModal.set(true)">Enable</ui-button>
          } @else if (!disabling()) {
          <ui-button variant="danger" size="sm" (click)="disabling.set(true)">Disable</ui-button>
          }
        </div>

        @if (twoFactorEnabled() && !disabling()) {
        <button
          type="button"
          class="mt-3 ml-[3.125rem] text-xs text-muted hover:text-primary transition-micro disabled:opacity-50"
          [disabled]="clearingDevices()"
          (click)="clearTrustedDevices()"
        >
          {{ clearingDevices() ? 'Clearing…' : 'Require 2FA on all devices again' }}
        </button>
        }

        @if (disabling()) {
        <div class="mt-3 ml-[3.125rem]">
          <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">
            Confirm Password to Disable
          </label>
          <input
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full px-3 py-2.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro"
            [ngModel]="disablePassword()"
            (ngModelChange)="disablePassword.set($event)"
            (keydown.enter)="confirmDisable()"
          />
          @if (disableError()) {
          <p class="text-xs text-danger mt-1.5">{{ disableError() }}</p>
          }
          <div class="flex items-center gap-2 mt-3">
            <button
              type="button"
              class="px-3 h-8 rounded-lg text-xs font-medium text-muted hover:text-primary hover:bg-surface transition-micro"
              (click)="cancelDisable()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="px-3 h-8 rounded-lg text-xs font-semibold bg-danger text-white hover:brightness-110 disabled:opacity-50 transition-micro"
              [disabled]="!disablePassword() || disableSubmitting()"
              (click)="confirmDisable()"
            >
              {{ disableSubmitting() ? 'Disabling…' : 'Disable 2FA' }}
            </button>
          </div>
        </div>
        }
      </div>
    </section>

    <!-- ============ SESSION ============ -->
    <section
      class="mt-8 flex items-center gap-3.5 rounded-2xl bg-surface-2 border border-border-subtle px-4 py-3.5"
    >
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-muted text-danger">
        <i class="fas fa-right-from-bracket"></i>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-primary">Log out</p>
        <p class="text-xs text-muted mt-0.5">End your session on this device.</p>
      </div>
      <ui-button variant="danger" size="sm" (click)="logout()">Log Out</ui-button>
    </section>

    @if (showEnableModal()) {
    <app-enable-2fa-modal
      (close)="showEnableModal.set(false)"
      (enabled)="onTwoFactorEnabled()"
    />
    }

    @if (showPasswordModal()) {
    <app-change-password-modal
      [hasPassword]="hasPassword()"
      (close)="showPasswordModal.set(false)"
      (done)="onPasswordChanged()"
    />
    }

    @if (showEmailModal()) {
    <app-change-email-modal (close)="showEmailModal.set(false)" />
    }

    @if (showUsernameModal()) {
    <app-change-username-modal
      (close)="showUsernameModal.set(false)"
      (done)="onUsernameChanged()"
    />
    }

    @if (cropRequest(); as crop) {
    <app-image-cropper-modal
      [file]="crop.file"
      [aspect]="crop.kind === 'avatar' ? 1 : 3.5"
      [outputWidth]="crop.kind === 'avatar' ? 512 : 1280"
      [heading]="crop.kind === 'avatar' ? 'Crop Avatar' : 'Crop Banner'"
      (cropped)="onCropped(crop.kind, $event)"
      (close)="cropRequest.set(null)"
    />
    }

    <input
      #avatarInput
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="hidden"
      (change)="onAssetSelected('avatar', $event)"
    />
    <input
      #bannerInput
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="hidden"
      (change)="onAssetSelected('banner', $event)"
    />
    } @else {
    <div class="flex justify-center py-16">
      <i class="spinner-brand text-faint text-xl"></i>
    </div>
    }
  `,
})
export class AccountSettings implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly userService = inject(UserService);
  private readonly fileService = inject(FileService);
  private readonly toast = inject(ToastService);
  private readonly profileStore = inject(ProfileStore);

  protected readonly me = signal<MyEditableProfile | null>(null);
  protected readonly bioDraft = signal('');
  protected readonly dobDraft = signal('');
  protected readonly colorDraft = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly uploading = signal<'avatar' | 'banner' | null>(null);
  protected readonly today = new Date().toISOString().slice(0, 10);

  /** Email lives on the auth session, not the editable-profile payload. Optimistic default
   * (true) so the nag never flashes before the session has loaded. */
  protected readonly email = computed(() => this.auth.currentUser()?.email ?? '');
  protected readonly emailVerified = computed(() => this.auth.currentUser()?.emailVerified ?? true);

  protected readonly resending = signal(false);
  protected readonly resendCooldown = signal(0);
  private cooldownTimer: ReturnType<typeof setInterval> | undefined;

  protected readonly twoFactorEnabled = computed(() => this.auth.currentUser()?.twoFactorEnabled ?? false);
  protected readonly hasPassword = computed(() => this.auth.currentUser()?.hasPassword ?? true);
  protected readonly cropRequest = signal<{ kind: 'avatar' | 'banner'; file: File } | null>(null);
  protected readonly showPasswordModal = signal(false);
  protected readonly showEmailModal = signal(false);
  protected readonly showUsernameModal = signal(false);
  protected readonly showEnableModal = signal(false);
  protected readonly disabling = signal(false);
  protected readonly disablePassword = signal('');
  protected readonly disableSubmitting = signal(false);
  protected readonly disableError = signal('');
  protected readonly clearingDevices = signal(false);

  protected readonly dirty = computed(() => {
    const me = this.me();
    if (!me) return false;
    return (
      this.bioDraft() !== (me.bio ?? '') ||
      this.dobDraft() !== (me.dateOfBirth ?? '') ||
      this.colorDraft() !== (me.bannerColor ?? '')
    );
  });

  ngOnInit(): void {
    void this.userService
      .getMe()
      .then((me) => {
        this.me.set(me);
        this.reset();
      })
      .catch(() => this.error.set('Could not load your profile.'));
  }

  ngOnDestroy(): void {
    clearInterval(this.cooldownTimer);
  }

  protected async logout(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log Out',
      danger: true,
    });
    if (ok) void this.auth.logout();
  }

  protected async resendVerification(): Promise<void> {
    if (this.resending() || this.resendCooldown() > 0) return;
    this.resending.set(true);
    try {
      await this.auth.requestEmailVerification();
      this.toast.info('Verification email sent — check your inbox.');
      this.startResendCooldown();
    } catch {
      this.toast.info('Could not send the verification email.', 'fa-circle-exclamation');
    } finally {
      this.resending.set(false);
    }
  }

  protected onTwoFactorEnabled(): void {
    this.showEnableModal.set(false);
    this.toast.info('Two-factor authentication enabled.');
  }

  protected onPasswordChanged(): void {
    this.showPasswordModal.set(false);
    this.toast.info('Password updated.');
  }

  protected onUsernameChanged(): void {
    this.showUsernameModal.set(false);
    const me = this.me();
    const username = this.auth.currentUser()?.username;
    if (me && username) this.me.set({ ...me, username });
    this.toast.info('Username changed.');
  }

  protected cancelDisable(): void {
    this.disabling.set(false);
    this.disablePassword.set('');
    this.disableError.set('');
  }

  protected async confirmDisable(): Promise<void> {
    if (!this.disablePassword() || this.disableSubmitting()) return;
    this.disableSubmitting.set(true);
    this.disableError.set('');
    try {
      await this.auth.disable2fa(this.disablePassword());
      this.cancelDisable();
      this.toast.info('Two-factor authentication disabled.');
    } catch (err) {
      this.disableError.set(extractApiError(err));
    } finally {
      this.disableSubmitting.set(false);
    }
  }

  protected async clearTrustedDevices(): Promise<void> {
    if (this.clearingDevices()) return;
    this.clearingDevices.set(true);
    try {
      await this.auth.clearTrustedDevices();
      this.toast.info('Every device will need a code on its next login.');
    } catch {
      this.toast.info('Could not clear trusted devices.', 'fa-circle-exclamation');
    } finally {
      this.clearingDevices.set(false);
    }
  }

  private startResendCooldown(): void {
    this.cooldownTimer = runResendCooldown(this.resendCooldown, this.cooldownTimer);
  }

  protected reset(): void {
    const me = this.me();
    this.bioDraft.set(me?.bio ?? '');
    this.dobDraft.set(me?.dateOfBirth ?? '');
    this.colorDraft.set(me?.bannerColor ?? '');
    this.error.set('');
  }

  protected async save(): Promise<void> {
    const me = this.me();
    if (!me || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.userService.updateProfile({
        bio: this.bioDraft(),
        dateOfBirth: this.dobDraft(),
        bannerColor: this.colorDraft(), // '' clears it
      });
      const bio = this.bioDraft().trim() || null;
      const dateOfBirth = this.dobDraft() || null;
      const bannerColor = this.colorDraft() || null;
      this.me.set({ ...me, bio, dateOfBirth, bannerColor });
      this.profileStore.patch(me.id, { bio, bannerColor });
      this.toast.info('Profile saved');
    } catch {
      this.error.set('Could not save your profile. Check the date of birth.');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- avatar / banner image upload (presign → PUT → confirm; applies immediately) ----

  private static readonly AssetTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  private static readonly MaxAssetBytes = 10 * 1024 * 1024; // mirrors the server cap

  protected async onAssetSelected(kind: 'avatar' | 'banner', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    const me = this.me();
    if (!file || !me || this.uploading()) return;

    if (!AccountSettings.AssetTypes.includes(file.type)) {
      this.toast.info('Use a png, jpeg, gif, or webp image.', 'fa-circle-exclamation');
      return;
    }
    if (file.size > AccountSettings.MaxAssetBytes) {
      this.toast.info('Image must be 10 MB or smaller.', 'fa-circle-exclamation');
      return;
    }

    // GIFs bypass the cropper — cropping would flatten the animation (the server skips them too).
    if (file.type === 'image/gif') {
      await this.uploadAsset(kind, file);
      return;
    }
    this.cropRequest.set({ kind, file });
  }

  protected async onCropped(kind: 'avatar' | 'banner', file: File): Promise<void> {
    this.cropRequest.set(null);
    await this.uploadAsset(kind, file);
  }

  /** The presign → PUT → confirm pipeline, shared by the crop flow and the GIF bypass. */
  private async uploadAsset(kind: 'avatar' | 'banner', file: File): Promise<void> {
    this.uploading.set(kind);
    try {
      const presign = await this.userService.presignAsset(kind, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await this.fileService.upload(presign.uploadUrl, file);
      const { key } = await this.userService.confirmAsset(kind, presign.fileId);
      this.applyAssetKey(kind, key);
    } catch {
      this.toast.info(`Could not upload the ${kind}.`, 'fa-circle-exclamation');
    } finally {
      this.uploading.set(null);
    }
  }

  protected async removeAsset(kind: 'avatar' | 'banner'): Promise<void> {
    if (this.uploading()) return;
    this.uploading.set(kind);
    try {
      await this.userService.removeAsset(kind);
      this.applyAssetKey(kind, null);
    } catch {
      this.toast.info(`Could not remove the ${kind}.`, 'fa-circle-exclamation');
    } finally {
      this.uploading.set(null);
    }
  }

  /** Applies a changed avatar/banner key locally + to every cached profile surface. */
  private applyAssetKey(kind: 'avatar' | 'banner', key: string | null): void {
    const me = this.me();
    if (!me) return;
    this.me.set(kind === 'avatar' ? { ...me, avatarKey: key } : { ...me, bannerKey: key });
    this.profileStore.patch(me.id, kind === 'avatar' ? { avatarKey: key } : { bannerKey: key });
    if (kind === 'avatar') this.auth.patchCurrentUser({ avatarKey: key });
  }
}
