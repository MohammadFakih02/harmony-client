import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GuildService } from '../../../core/services/guild.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { GuildSummary } from '../../../core/models/guild.models';
import { UiProfileBanner, ConfirmService } from '../../../shared/ui';
import { publicFileUrl } from '../../../shared/util/public-file-url';
import { extractApiError } from '../../../shared/util/api-error';
import { MobileNavService } from '../../../core/services/mobile-nav.service';

/**
 * Public-server discovery — browse discoverable (is_public) guilds, biggest first, with a debounced
 * name search. Joining needs no invite (the server runs the same ban/membership checks as an invite
 * redeem); already-joined guilds show "Open" and route in instead.
 */
@Component({
  selector: 'app-discover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, UiProfileBanner],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  template: `
    <header class="flex items-center gap-3 px-6 max-md:px-3 h-14 shrink-0 border-b border-border-subtle">
      <button
        type="button"
        class="hidden max-md:flex w-9 h-9 items-center justify-center rounded-lg text-muted hover:text-primary shrink-0"
        aria-label="Open navigation"
        (click)="mobileNav.openLeft()"
      >
        <i class="fas fa-bars"></i>
      </button>
      <i class="fas fa-compass text-lg text-accent"></i>
      <h1 class="text-lg font-bold text-primary">Discover</h1>
    </header>

    <div class="flex-1 overflow-y-auto px-6 py-6">
      <div class="max-w-4xl mx-auto">
        <div class="relative mb-6">
          <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm"></i>
          <input
            type="text"
            placeholder="Search public servers"
            class="w-full pl-9 pr-3 py-2.5 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
          />
        </div>

        @if (loading()) {
        <div class="flex justify-center py-16">
          <i class="fas fa-yin-yang animate-spin text-faint text-xl"></i>
        </div>
        } @else if (results().length === 0) {
        <div class="flex flex-col items-center gap-2 py-16 text-center">
          <i class="fas fa-compass text-3xl text-faint"></i>
          <p class="text-sm text-muted">
            {{ query().trim() ? 'No servers match your search.' : 'No public servers to discover yet.' }}
          </p>
        </div>
        } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (guild of results(); track guild.id) {
          <div class="rounded-xl bg-surface-2 border border-border-subtle overflow-hidden flex flex-col">
            <ui-profile-banner class="h-20" [bannerKey]="guild.bannerKey" [alt]="guild.name" />
            <div class="px-4 pb-4 flex flex-col flex-1">
              <div class="relative z-10 -mt-8 mb-2">
                <div
                  class="w-14 h-14 rounded-2xl ring-4 ring-surface-2 bg-surface-3 overflow-hidden flex items-center justify-center text-lg font-semibold text-muted"
                >
                  @if (guild.iconKey) {
                  <img [src]="iconUrl(guild.iconKey)" [alt]="guild.name" class="w-full h-full object-cover" />
                  } @else {
                  {{ initials(guild.name) }}
                  }
                </div>
              </div>
              <p class="font-bold text-primary truncate">{{ guild.name }}</p>
              @if (guild.description) {
              <p class="text-xs text-muted mt-1 line-clamp-2 flex-1">{{ guild.description }}</p>
              } @else {
              <div class="flex-1"></div>
              }
              <div class="flex items-center gap-1.5 text-2xs text-faint mt-2 mb-3">
                <i class="fas fa-user-group"></i>
                <span>{{ guild.memberCount }} {{ guild.memberCount === 1 ? 'member' : 'members' }}</span>
              </div>
              @if (isMember(guild.id)) {
              <button
                type="button"
                class="w-full h-9 rounded-lg text-sm font-semibold bg-surface-3 text-primary hover:bg-surface transition-micro"
                (click)="openGuild(guild.id)"
              >
                Open
              </button>
              } @else {
              <button
                type="button"
                class="w-full h-9 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-micro"
                [disabled]="joiningId() === guild.id"
                (click)="join(guild)"
              >
                @if (joiningId() === guild.id) {<i class="fas fa-yin-yang animate-spin mr-1"></i>}
                Join
              </button>
              }
            </div>
          </div>
          }
        </div>
        }
      </div>
    </div>
  `,
})
export class Discover implements OnInit {
  private readonly guildService = inject(GuildService);
  private readonly guildStore = inject(GuildStore);
  private readonly router = inject(Router);
  private readonly confirmService = inject(ConfirmService);
  protected readonly mobileNav = inject(MobileNavService);

  protected readonly query = signal('');
  protected readonly results = signal<GuildSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly joiningId = signal<string | null>(null);

  private searchTimer?: ReturnType<typeof setTimeout>;

  private readonly memberIds = computed(() => new Set(this.guildStore.guilds().map((g) => g.id)));

  protected isMember(guildId: string): boolean {
    return this.memberIds().has(guildId);
  }

  protected iconUrl(key: string): string {
    return publicFileUrl(key)!;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  ngOnInit(): void {
    void this.load();
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 350);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.results.set(await this.guildService.discover(this.query()));
    } catch {
      this.results.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected openGuild(guildId: string): void {
    void this.router.navigate(['/app/guilds', guildId]);
  }

  protected async join(guild: GuildSummary): Promise<void> {
    if (this.joiningId()) return;
    this.joiningId.set(guild.id);
    try {
      const joined = await this.guildService.joinPublic(guild.id);
      this.guildStore.addGuild(joined);
      void this.router.navigate(['/app/guilds', joined.id]);
    } catch (err) {
      // 409 already-member → just open it; anything else surfaces the server's reason (e.g. ban).
      const message = extractApiError(err);
      if (message.toLowerCase().includes('already a member')) {
        void this.router.navigate(['/app/guilds', guild.id]);
      } else {
        void this.confirmService.notice({ title: "Couldn't Join Server", message });
      }
    } finally {
      this.joiningId.set(null);
    }
  }
}
