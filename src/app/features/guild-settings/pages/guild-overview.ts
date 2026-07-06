import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GuildStore } from '../../../core/stores/guild.store';
import { GuildService } from '../../../core/services/guild.service';
import { FileService } from '../../../core/services/file.service';
import { ToastService } from '../../../core/services/toast.service';
import { SettingsToggle } from '../../settings/ui/settings-toggle';
import { UiProfileBanner } from '../../../shared/ui';
import { publicFileUrl } from '../../../shared/util/public-file-url';

/** Admin Overview: icon/banner, rename, describe, and toggle public discoverability. ManageGuild-gated. */
@Component({
  selector: 'app-guild-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SettingsToggle, UiProfileBanner],
  template: `
    <h2 class="text-xl font-bold text-primary mb-5">Overview</h2>

    <!-- Icon + banner -->
    <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden mb-5">
      <ui-profile-banner class="h-24" [bannerKey]="bannerKey()" [alt]="name()">
        <div class="absolute bottom-2 right-2 flex gap-1.5">
          <button
            type="button"
            class="px-2.5 py-1 rounded-md text-xs font-semibold bg-black/50 text-white hover:bg-black/70 disabled:opacity-50 transition-micro"
            [disabled]="uploading() !== null"
            (click)="bannerInput.click()"
          >
            @if (uploading() === 'banner') {<i class="fas fa-yin-yang animate-spin mr-1"></i>}
            @else {<i class="fas fa-image mr-1"></i>}
            Change Banner
          </button>
          @if (bannerKey()) {
          <button
            type="button"
            class="px-2.5 py-1 rounded-md text-xs font-semibold bg-black/50 text-white/80 hover:bg-black/70 hover:text-white disabled:opacity-50 transition-micro"
            [disabled]="uploading() !== null"
            (click)="removeAsset('banner')"
          >
            <i class="fas fa-trash-can mr-1"></i>Remove
          </button>
          }
        </div>
      </ui-profile-banner>

      <div class="px-4 pb-4">
        <div class="relative z-10 inline-block -mt-10">
          <div
            class="w-20 h-20 rounded-2xl ring-[5px] ring-surface-2 bg-surface-3 overflow-hidden flex items-center justify-center text-2xl font-semibold text-muted"
          >
            @if (iconKey()) {
            <img [src]="iconUrl()" [alt]="name()" class="w-full h-full object-cover" />
            } @else {
            {{ initials() }}
            }
          </div>
          <button
            type="button"
            class="absolute inset-0 rounded-2xl bg-black/45 text-white opacity-0 hover:opacity-100 focus-visible:opacity-100 flex items-center justify-center transition-micro"
            [disabled]="uploading() !== null"
            aria-label="Change icon"
            (click)="iconInput.click()"
          >
            @if (uploading() === 'icon') {<i class="fas fa-yin-yang animate-spin"></i>}
            @else {<i class="fas fa-camera"></i>}
          </button>
          @if (iconKey()) {
          <button
            type="button"
            class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-danger text-white text-2xs flex items-center justify-center shadow-sm hover:brightness-110 transition-micro"
            [disabled]="uploading() !== null"
            aria-label="Remove icon"
            (click)="removeAsset('icon')"
          >
            <i class="fas fa-xmark"></i>
          </button>
          }
        </div>
      </div>
    </div>

    <input
      #iconInput
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="hidden"
      (change)="onAssetSelected('icon', $event)"
    />
    <input
      #bannerInput
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      class="hidden"
      (change)="onAssetSelected('banner', $event)"
    />

    <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">Server Name</label>
    <input
      class="mb-4 w-full rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
      [(ngModel)]="name"
      maxlength="100"
      (keydown.enter)="save()"
    />

    <label class="block text-2xs font-bold uppercase tracking-wider text-faint mb-1.5">Description</label>
    <textarea
      class="mb-2 w-full resize-none rounded bg-surface-3 px-3 py-2 text-sm text-primary outline-none"
      rows="3"
      [(ngModel)]="description"
    ></textarea>

    <div class="border-t border-border-subtle mt-2">
      <app-settings-toggle
        label="Public Server"
        description="List this server in Discover so anyone can find and join it."
        [checked]="isPublic()"
        (toggled)="isPublic.set($event)"
      />
    </div>

    <div class="mt-6 flex items-center gap-3">
      <button
        type="button"
        class="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        [disabled]="!dirty() || saving()"
        (click)="save()"
      >
        {{ saving() ? 'Saving…' : 'Save Changes' }}
      </button>
      @if (dirty()) {
      <button type="button" class="text-sm text-muted hover:text-primary" (click)="reset()">
        Reset
      </button>
      }
    </div>
  `,
})
export class GuildOverview implements OnInit {
  readonly guildId = input.required<string>();

  private readonly guildStore = inject(GuildStore);
  private readonly guildService = inject(GuildService);
  private readonly fileService = inject(FileService);
  private readonly toast = inject(ToastService);

  private readonly guild = computed(() =>
    this.guildStore.guilds().find((g) => g.id === this.guildId()) ?? null,
  );

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isPublic = signal(false);
  protected readonly saving = signal(false);
  protected readonly uploading = signal<'icon' | 'banner' | null>(null);

  // Asset keys mirror the store; kept as local signals so uploads reflect immediately.
  protected readonly iconKey = signal<string | null>(null);
  protected readonly bannerKey = signal<string | null>(null);
  protected readonly iconUrl = computed(() => publicFileUrl(this.iconKey()));

  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );

  protected readonly dirty = computed(() => {
    const g = this.guild();
    if (!g) return false;
    return (
      this.name() !== g.name ||
      this.description() !== (g.description ?? '') ||
      this.isPublic() !== g.isPublic
    );
  });

  // Seed from the guild in ngOnInit, not the constructor: the required `guildId` input
  // isn't bound yet at construction, so reading it there throws NG0950 and blanks the tab.
  ngOnInit(): void {
    this.reset();
  }

  protected reset(): void {
    const g = this.guild();
    if (!g) return;
    this.name.set(g.name);
    this.description.set(g.description ?? '');
    this.isPublic.set(g.isPublic);
    this.iconKey.set(g.iconKey);
    this.bannerKey.set(g.bannerKey);
  }

  protected async save(): Promise<void> {
    if (!this.dirty()) return;
    this.saving.set(true);
    try {
      const updated = await this.guildService.updateGuild(this.guildId(), {
        name: this.name().trim(),
        description: this.description().trim() || null,
        isPublic: this.isPublic(),
      });
      this.guildStore.applyGuildUpdate(updated);
    } finally {
      this.saving.set(false);
    }
  }

  // ---- icon / banner upload (presign → PUT → confirm; applies immediately) ----

  private static readonly AssetTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  private static readonly MaxAssetBytes = 10 * 1024 * 1024;

  protected async onAssetSelected(kind: 'icon' | 'banner', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploading()) return;

    if (!GuildOverview.AssetTypes.includes(file.type)) {
      this.toast.info('Use a png, jpeg, gif, or webp image.', 'fa-circle-exclamation');
      return;
    }
    if (file.size > GuildOverview.MaxAssetBytes) {
      this.toast.info('Image must be 10 MB or smaller.', 'fa-circle-exclamation');
      return;
    }

    this.uploading.set(kind);
    try {
      const presign = await this.guildService.presignAsset(this.guildId(), kind, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await this.fileService.upload(presign.uploadUrl, file);
      const { key } = await this.guildService.confirmAsset(this.guildId(), kind, presign.fileId);
      this.applyAssetKey(kind, key);
    } catch {
      this.toast.info(`Could not upload the ${kind}.`, 'fa-circle-exclamation');
    } finally {
      this.uploading.set(null);
    }
  }

  protected async removeAsset(kind: 'icon' | 'banner'): Promise<void> {
    if (this.uploading()) return;
    this.uploading.set(kind);
    try {
      await this.guildService.removeAsset(this.guildId(), kind);
      this.applyAssetKey(kind, null);
    } catch {
      this.toast.info(`Could not remove the ${kind}.`, 'fa-circle-exclamation');
    } finally {
      this.uploading.set(null);
    }
  }

  /** Applies a changed icon/banner key locally + to the guild store (rail icon updates live). */
  private applyAssetKey(kind: 'icon' | 'banner', key: string | null): void {
    const g = this.guild();
    if (kind === 'icon') this.iconKey.set(key);
    else this.bannerKey.set(key);
    if (g) {
      this.guildStore.applyGuildUpdate(
        kind === 'icon' ? { ...g, iconKey: key } : { ...g, bannerKey: key },
      );
    }
  }
}
