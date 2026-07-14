import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Channel, ChannelOverride } from '../../../core/models/channel.models';
import {
  OverrideTriState,
  overridePermGroups,
  overrideStateOf,
  withOverrideState,
} from '../../../core/models/channel-override.utils';
import { roleColorHex } from '../../../core/models/role.models';
import { ChannelService } from '../../../core/services/channel.service';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';

/** Slowmode presets (seconds) offered in the editor — 0 = off, Discord's ladder. */
const SLOWMODE_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Off', seconds: 0 },
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
];

/** Voice bitrate presets (kbps) — 8–96, LiveKit/Discord's free-tier ladder; default 64. */
const BITRATE_OPTIONS_KBPS = [8, 16, 32, 64, 96];

/** One row of the override target list: @everyone (always shown), or a role/member override. */
interface OverrideTarget {
  key: string; // `${targetType}:${targetId}` — the selection/edit-map key
  targetType: 'role' | 'user';
  targetId: string;
  name: string;
  color: string | null; // role colour swatch (null = uncoloured or a member)
  isEveryone: boolean;
}

const keyOf = (targetType: string, targetId: string): string => `${targetType}:${targetId}`;

/**
 * Channel settings editor (ManageChannels). Overview tab — text channels: name, topic, NSFW flag,
 * slowmode; voice channels: name plus bitrate and user limit (0 = no limit; the server enforces
 * the cap, MoveMembers holders bypass it). Saves through ChannelStore.saveChannel; the
 * ChannelUpdated broadcast reconciles other clients.
 *
 * Permissions tab (ManageRoles) — the per-channel override editor: @everyone plus any role/member
 * targets, each with a tri-state (allow / neutral / deny) row per channel-scoped permission.
 * Edits are per-target and saved one PUT at a time; the backend re-validates (ManageRoles gate,
 * no allow/deny overlap) and the ChannelOverridesChanged broadcast resyncs everyone's channel
 * list + capabilities live.
 */
@Component({
  selector: 'app-channel-settings-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      (click)="close.emit()"
    >
      <div
        class="bg-surface rounded-xl shadow-modal border border-border w-full mx-4 p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        [class.max-w-md]="tab() === 'overview'"
        [class.max-w-3xl]="tab() === 'permissions'"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-2">
          <i class="fas text-faint" [class.fa-hashtag]="!isVoice()" [class.fa-volume-up]="isVoice()"></i>
          <h2 class="text-lg font-bold text-primary">Edit Channel</h2>
        </div>

        @if (canManageRoles()) {
        <div class="flex gap-1 -mt-2 border-b border-border-subtle">
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-micro"
            [class.border-accent]="tab() === 'overview'"
            [class.text-primary]="tab() === 'overview'"
            [class.border-transparent]="tab() !== 'overview'"
            [class.text-muted]="tab() !== 'overview'"
            (click)="tab.set('overview')"
          >
            Overview
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-micro"
            [class.border-accent]="tab() === 'permissions'"
            [class.text-primary]="tab() === 'permissions'"
            [class.border-transparent]="tab() !== 'permissions'"
            [class.text-muted]="tab() !== 'permissions'"
            (click)="openPermissions()"
          >
            Permissions
          </button>
        </div>
        }

        @if (tab() === 'overview') {
        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Channel Name</label>
          <input
            type="text"
            maxlength="100"
            class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            (keydown.enter)="save()"
          />
        </div>

        @if (!isVoice()) {
        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Channel Topic</label>
          <textarea
            rows="3"
            maxlength="1024"
            placeholder="What is this channel about?"
            class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro resize-none"
            [ngModel]="topic()"
            (ngModelChange)="topic.set($event)"
          ></textarea>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Slowmode</label>
          <div class="flex flex-wrap gap-1.5">
            @for (opt of slowmodeOptions; track opt.seconds) {
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-medium border transition-micro"
              [class.bg-accent]="slowmode() === opt.seconds"
              [class.text-white]="slowmode() === opt.seconds"
              [class.border-accent]="slowmode() === opt.seconds"
              [class.border-border-subtle]="slowmode() !== opt.seconds"
              [class.text-muted]="slowmode() !== opt.seconds"
              [class.hover:bg-surface-2]="slowmode() !== opt.seconds"
              (click)="slowmode.set(opt.seconds)"
            >
              {{ opt.label }}
            </button>
            }
          </div>
          <p class="text-2xs text-faint">
            Members can send one message per interval. Moderators are exempt.
          </p>
        </div>

        <button
          type="button"
          class="flex items-center justify-between gap-3 rounded-lg bg-surface-2 border border-border-subtle px-3.5 py-3 text-left transition-micro hover:bg-surface-3"
          (click)="isNsfw.set(!isNsfw())"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-primary">Age-Restricted Channel (NSFW)</p>
            <p class="text-2xs text-faint mt-0.5">
              Users must confirm they're of age before viewing this channel.
            </p>
          </div>
          <span
            class="relative w-9 h-5 rounded-full transition-micro shrink-0"
            [class.bg-accent]="isNsfw()"
            [class.bg-surface-3]="!isNsfw()"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              [class.translate-x-4]="isNsfw()"
            ></span>
          </span>
        </button>
        } @else {
        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">Audio Bitrate</label>
          <div class="flex flex-wrap gap-1.5">
            @for (kbps of bitrateOptions; track kbps) {
            <button
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-medium border transition-micro"
              [class.bg-accent]="bitrateKbps() === kbps"
              [class.text-white]="bitrateKbps() === kbps"
              [class.border-accent]="bitrateKbps() === kbps"
              [class.border-border-subtle]="bitrateKbps() !== kbps"
              [class.text-muted]="bitrateKbps() !== kbps"
              [class.hover:bg-surface-2]="bitrateKbps() !== kbps"
              (click)="bitrateKbps.set(kbps)"
            >
              {{ kbps }} kbps
            </button>
            }
          </div>
          <p class="text-2xs text-faint">
            Higher bitrate means better voice quality and more bandwidth per speaker.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-2xs font-bold uppercase tracking-wider text-faint">User Limit</label>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="99"
              step="1"
              class="flex-1 accent-accent"
              [ngModel]="userLimit()"
              (ngModelChange)="userLimit.set(+$event)"
              aria-label="User limit"
            />
            <span class="text-sm text-primary w-16 text-right tabular-nums">
              {{ userLimit() === 0 ? 'No limit' : userLimit() }}
            </span>
          </div>
          <p class="text-2xs text-faint">
            Members can't join a full channel — moderators with Move Members can.
          </p>
        </div>
        }

        @if (error()) {
        <p class="text-xs text-danger">{{ error() }}</p>
        }

        <div class="flex gap-2 justify-end pt-1">
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition-micro"
            (click)="close.emit()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-micro"
            [disabled]="saving() || !name().trim() || !dirty()"
            (click)="save()"
          >
            {{ saving() ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
        } @else {
        <!-- ============================ Permissions tab ============================ -->
        <div class="flex gap-4 min-h-90">
          <!-- Target list: @everyone + role/member overrides -->
          <div class="w-48 shrink-0 flex flex-col gap-1 border-r border-border-subtle pr-3 overflow-y-auto">
            <div class="flex items-center justify-between mb-1">
              <span class="text-2xs font-bold uppercase tracking-wider text-faint">Roles / Members</span>
              <button
                type="button"
                class="w-6 h-6 rounded-md text-muted hover:text-primary hover:bg-surface-2 transition-micro"
                aria-label="Add role or member"
                (click)="toggleAddTarget()"
              >
                <i class="fas fa-plus text-xs"></i>
              </button>
            </div>

            @if (addingTarget()) {
            <div class="flex flex-col gap-1 rounded-lg bg-surface-2 border border-border-subtle p-2 mb-1">
              <input
                type="text"
                placeholder="Search roles or members…"
                class="w-full px-2 py-1 rounded-md bg-surface border border-border-subtle text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent"
                [ngModel]="targetFilter()"
                (ngModelChange)="targetFilter.set($event)"
              />
              <div class="max-h-40 overflow-y-auto flex flex-col">
                @for (cand of addCandidates(); track cand.key) {
                <button
                  type="button"
                  class="flex items-center gap-2 px-2 py-1 rounded-md text-left text-xs text-muted hover:text-primary hover:bg-surface-3 transition-micro"
                  (click)="addTarget(cand)"
                >
                  @if (cand.targetType === 'role') {
                  <span
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    [style.background-color]="cand.color ?? 'var(--color-text-faint)'"
                  ></span>
                  } @else {
                  <i class="fas fa-user text-2xs text-faint shrink-0"></i>
                  }
                  <span class="truncate">{{ cand.name }}</span>
                </button>
                } @empty {
                <p class="px-2 py-1 text-2xs text-faint">No matches.</p>
                }
              </div>
            </div>
            }

            @for (t of targets(); track t.key) {
            <button
              type="button"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-micro"
              [class.bg-surface-2]="selectedKey() === t.key"
              [class.text-primary]="selectedKey() === t.key"
              [class.text-muted]="selectedKey() !== t.key"
              [class.hover:bg-surface-2]="selectedKey() !== t.key"
              (click)="selectTarget(t.key)"
            >
              @if (t.targetType === 'role') {
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                [style.background-color]="t.color ?? 'var(--color-text-faint)'"
              ></span>
              } @else {
              <i class="fas fa-user text-2xs text-faint shrink-0"></i>
              }
              <span class="truncate flex-1">{{ t.name }}</span>
              @if (isDirty(t.key)) {
              <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="Unsaved changes"></span>
              }
            </button>
            }
          </div>

          <!-- Tri-state matrix for the selected target -->
          <div class="flex-1 flex flex-col min-w-0">
            @if (overrides() === null) {
            <p class="text-sm text-faint m-auto">Loading overrides…</p>
            } @else {
            <div class="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
              @for (group of permGroups(); track group.category) {
              <div>
                <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-1">
                  {{ group.category }}
                </p>
                @for (perm of group.perms; track perm.bit) {
                <div class="flex items-center justify-between gap-3 py-2 border-b border-border-subtle/50">
                  <div class="min-w-0">
                    <p class="text-sm text-primary">{{ perm.label }}</p>
                    <p class="text-2xs text-faint">{{ perm.description }}</p>
                  </div>
                  <div class="flex rounded-md overflow-hidden border border-border-subtle shrink-0">
                    <button
                      type="button"
                      class="w-9 h-7 text-xs transition-micro"
                      [class.bg-danger]="stateFor(perm.bit) === 'deny'"
                      [class.text-white]="stateFor(perm.bit) === 'deny'"
                      [class.text-muted]="stateFor(perm.bit) !== 'deny'"
                      [class.hover:bg-surface-2]="stateFor(perm.bit) !== 'deny'"
                      aria-label="Deny"
                      (click)="setState(perm.bit, 'deny')"
                    >
                      <i class="fas fa-times"></i>
                    </button>
                    <button
                      type="button"
                      class="w-9 h-7 text-xs border-x border-border-subtle transition-micro"
                      [class.bg-surface-3]="stateFor(perm.bit) === 'neutral'"
                      [class.text-primary]="stateFor(perm.bit) === 'neutral'"
                      [class.text-muted]="stateFor(perm.bit) !== 'neutral'"
                      [class.hover:bg-surface-2]="stateFor(perm.bit) !== 'neutral'"
                      aria-label="Inherit (neutral)"
                      (click)="setState(perm.bit, 'neutral')"
                    >
                      <i class="fas fa-slash"></i>
                    </button>
                    <button
                      type="button"
                      class="w-9 h-7 text-xs transition-micro"
                      [class.bg-success]="stateFor(perm.bit) === 'allow'"
                      [class.text-white]="stateFor(perm.bit) === 'allow'"
                      [class.text-muted]="stateFor(perm.bit) !== 'allow'"
                      [class.hover:bg-surface-2]="stateFor(perm.bit) !== 'allow'"
                      aria-label="Allow"
                      (click)="setState(perm.bit, 'allow')"
                    >
                      <i class="fas fa-check"></i>
                    </button>
                  </div>
                </div>
                }
              </div>
              }
            </div>

            @if (permsError()) {
            <p class="text-xs text-danger pt-2">{{ permsError() }}</p>
            }

            <div class="flex items-center gap-2 pt-3">
              @if (canRemoveSelected()) {
              <button
                type="button"
                class="px-3 py-2 rounded-lg text-sm font-medium text-danger hover:bg-danger-muted transition-micro disabled:opacity-50"
                [disabled]="permSaving()"
                (click)="removeOverride()"
              >
                Remove Override
              </button>
              }
              <div class="flex-1"></div>
              <button
                type="button"
                class="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition-micro"
                (click)="close.emit()"
              >
                Close
              </button>
              <button
                type="button"
                class="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-micro"
                [disabled]="permSaving() || !isDirty(selectedKey())"
                (click)="saveOverride()"
              >
                {{ permSaving() ? 'Saving…' : 'Save Override' }}
              </button>
            </div>
            }
          </div>
        </div>
        }
      </div>
    </div>
  `,
})
export class ChannelSettingsModal {
  readonly channel = input.required<Channel>();
  readonly close = output<void>();

  private readonly channelStore = inject(ChannelStore);
  private readonly channelService = inject(ChannelService);
  private readonly roleStore = inject(RoleStore);
  private readonly memberStore = inject(MemberStore);

  protected readonly slowmodeOptions = SLOWMODE_OPTIONS;
  protected readonly bitrateOptions = BITRATE_OPTIONS_KBPS;

  protected readonly name = signal('');
  protected readonly topic = signal('');
  protected readonly isNsfw = signal(false);
  protected readonly slowmode = signal(0);
  protected readonly bitrateKbps = signal(64);
  protected readonly userLimit = signal(0); // 0 = no limit
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  // --- Permissions tab state ---
  protected readonly tab = signal<'overview' | 'permissions'>('overview');
  protected readonly overrides = signal<ChannelOverride[] | null>(null); // null = not loaded
  protected readonly selectedKey = signal('');
  protected readonly addingTarget = signal(false);
  protected readonly targetFilter = signal('');
  protected readonly permSaving = signal(false);
  protected readonly permsError = signal('');
  /** Per-target pending edits — switching targets never discards work in progress. */
  private readonly editedByKey = signal<Record<string, { allowBits: number; denyBits: number }>>({});
  /** Targets added via the picker but not yet saved (no server row exists). */
  private readonly localTargets = signal<{ targetType: 'role' | 'user'; targetId: string }[]>([]);

  protected readonly isVoice = computed(() => this.channel().type === 'voice');

  protected readonly canManageRoles = computed(
    () => !!this.memberStore.capabilitiesOf(this.channel().guildId)?.canManageRoles,
  );

  protected readonly permGroups = computed(() => overridePermGroups(this.channel().type));

  /** @everyone first (always shown), then role overrides in rank order, then members by name. */
  protected readonly targets = computed<OverrideTarget[]>(() => {
    const c = this.channel();
    const roles = this.roleStore.rolesOf(c.guildId);
    const members = this.memberStore.membersOf(c.guildId);

    const keys = new Set<string>();
    for (const o of this.overrides() ?? []) keys.add(keyOf(o.targetType, o.targetId));
    for (const t of this.localTargets()) keys.add(keyOf(t.targetType, t.targetId));

    const out: OverrideTarget[] = [];
    const everyone = roles.find((r) => r.isDefault);
    if (everyone) {
      keys.delete(keyOf('role', everyone.id));
      out.push({
        key: keyOf('role', everyone.id),
        targetType: 'role',
        targetId: everyone.id,
        name: '@everyone',
        color: null,
        isEveryone: true,
      });
    }
    // rolesOf is rank-sorted, so role targets come out in rank order.
    for (const r of roles) {
      if (keys.delete(keyOf('role', r.id))) {
        out.push({
          key: keyOf('role', r.id),
          targetType: 'role',
          targetId: r.id,
          name: r.name,
          color: roleColorHex(r.color),
          isEveryone: false,
        });
      }
    }
    const userTargets = [...keys]
      .filter((k) => k.startsWith('user:'))
      .map((k) => {
        const id = k.slice('user:'.length);
        const m = members.find((x) => x.userId === id);
        return {
          key: k,
          targetType: 'user' as const,
          targetId: id,
          name: m ? (m.nickname ?? m.username) : 'Unknown member',
          color: null,
          isEveryone: false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push(...userTargets);
    return out;
  });

  /** Picker candidates: roles (sans @everyone) then members, minus existing targets, filtered. */
  protected readonly addCandidates = computed<OverrideTarget[]>(() => {
    const c = this.channel();
    const existing = new Set(this.targets().map((t) => t.key));
    const q = this.targetFilter().trim().toLowerCase();

    const roles = this.roleStore
      .rolesOf(c.guildId)
      .filter((r) => !r.isDefault && !existing.has(keyOf('role', r.id)))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .map((r) => ({
        key: keyOf('role', r.id),
        targetType: 'role' as const,
        targetId: r.id,
        name: r.name,
        color: roleColorHex(r.color),
        isEveryone: false,
      }));
    const members = this.memberStore
      .membersOf(c.guildId)
      .filter((m) => !existing.has(keyOf('user', m.userId)))
      .filter(
        (m) =>
          !q ||
          m.username.toLowerCase().includes(q) ||
          (m.nickname ?? '').toLowerCase().includes(q),
      )
      .map((m) => ({
        key: keyOf('user', m.userId),
        targetType: 'user' as const,
        targetId: m.userId,
        name: m.nickname ?? m.username,
        color: null,
        isEveryone: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...roles, ...members];
  });

  protected readonly dirty = computed(() => {
    const c = this.channel();
    if (this.name().trim() !== c.name) return true;
    if (this.isVoice()) {
      return (
        this.bitrateKbps() !== Math.round((c.bitrate ?? 64000) / 1000) ||
        this.userLimit() !== (c.userLimit ?? 0)
      );
    }
    return (
      this.topic() !== (c.topic ?? '') ||
      this.isNsfw() !== c.isNsfw ||
      this.slowmode() !== c.slowmodeSeconds
    );
  });

  constructor() {
    // Seed the form from the channel input once it's set (inputs are available in the field
    // initializer order after construction, so read it lazily via an effect-free assignment here).
    queueMicrotask(() => {
      const c = this.channel();
      this.name.set(c.name);
      this.topic.set(c.topic ?? '');
      this.isNsfw.set(c.isNsfw);
      this.slowmode.set(c.slowmodeSeconds);
      this.bitrateKbps.set(Math.round((c.bitrate ?? 64000) / 1000));
      this.userLimit.set(c.userLimit ?? 0);
    });
  }

  protected async save(): Promise<void> {
    const c = this.channel();
    const name = this.name().trim();
    if (!name || this.saving() || !this.dirty()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.channelStore.saveChannel(
        c.guildId!,
        c.id,
        this.isVoice()
          ? {
              name,
              // bps on the wire; userLimit 0 clears the limit server-side (null = unchanged).
              bitrate: this.bitrateKbps() * 1000,
              userLimit: this.userLimit(),
            }
          : {
              name,
              topic: this.topic().trim() || null,
              isNsfw: this.isNsfw(),
              slowmodeSeconds: this.slowmode(),
            },
      );
      this.close.emit();
    } catch {
      this.error.set('Could not save the channel. Check your permissions.');
    } finally {
      this.saving.set(false);
    }
  }

  // ------------------------- Permissions tab -------------------------

  protected openPermissions(): void {
    this.tab.set('permissions');
    void this.loadPermissions();
  }

  private async loadPermissions(): Promise<void> {
    const c = this.channel();
    this.permsError.set('');
    try {
      await Promise.all([
        this.roleStore.loadIfNeeded(c.guildId),
        this.memberStore.loadIfNeeded(c.guildId),
      ]);
      this.overrides.set(await this.channelService.listOverrides(c.guildId, c.id));
      if (!this.selectedKey()) {
        const everyone = this.roleStore.rolesOf(c.guildId).find((r) => r.isDefault);
        if (everyone) this.selectedKey.set(keyOf('role', everyone.id));
      }
    } catch {
      this.permsError.set('Could not load permission overrides.');
      this.overrides.set([]);
    }
  }

  protected selectTarget(key: string): void {
    this.selectedKey.set(key);
    this.addingTarget.set(false);
  }

  protected toggleAddTarget(): void {
    this.addingTarget.update((v) => !v);
    this.targetFilter.set('');
  }

  protected addTarget(cand: OverrideTarget): void {
    this.localTargets.update((l) => [...l, { targetType: cand.targetType, targetId: cand.targetId }]);
    this.selectedKey.set(cand.key);
    this.addingTarget.set(false);
    this.targetFilter.set('');
  }

  /** The selected target's persisted override bits, or null when no server row exists. */
  private persistedBits(key: string): { allowBits: number; denyBits: number } | null {
    const o = (this.overrides() ?? []).find((x) => keyOf(x.targetType, x.targetId) === key);
    return o ? { allowBits: o.allowBits, denyBits: o.denyBits } : null;
  }

  private bitsFor(key: string): { allowBits: number; denyBits: number } {
    return this.editedByKey()[key] ?? this.persistedBits(key) ?? { allowBits: 0, denyBits: 0 };
  }

  protected stateFor(bit: number): OverrideTriState {
    const b = this.bitsFor(this.selectedKey());
    return overrideStateOf(b.allowBits, b.denyBits, bit);
  }

  protected setState(bit: number, state: OverrideTriState): void {
    const key = this.selectedKey();
    if (!key) return;
    const b = this.bitsFor(key);
    this.editedByKey.update((m) => ({
      ...m,
      [key]: withOverrideState(b.allowBits, b.denyBits, bit, state),
    }));
  }

  protected isDirty(key: string): boolean {
    const edited = this.editedByKey()[key];
    if (!edited) return false;
    const base = this.persistedBits(key) ?? { allowBits: 0, denyBits: 0 };
    return edited.allowBits !== base.allowBits || edited.denyBits !== base.denyBits;
  }

  /** Remove is offered for a persisted override, or a picker-added target not yet saved. */
  protected canRemoveSelected(): boolean {
    const key = this.selectedKey();
    if (!key) return false;
    if (this.persistedBits(key)) return true;
    return this.localTargets().some((t) => keyOf(t.targetType, t.targetId) === key);
  }

  protected async saveOverride(): Promise<void> {
    const key = this.selectedKey();
    const target = this.targets().find((t) => t.key === key);
    if (!target || !this.isDirty(key) || this.permSaving()) return;
    const bits = this.bitsFor(key);
    const c = this.channel();
    this.permSaving.set(true);
    this.permsError.set('');
    try {
      const saved = await this.channelService.upsertOverride(c.guildId, c.id, target.targetId, {
        targetType: target.targetType,
        allowBits: bits.allowBits,
        denyBits: bits.denyBits,
      });
      this.overrides.update((list) => [
        ...(list ?? []).filter((o) => keyOf(o.targetType, o.targetId) !== key),
        saved,
      ]);
      this.dropLocalState(key);
    } catch {
      this.permsError.set('Could not save the override. Check your permissions.');
    } finally {
      this.permSaving.set(false);
    }
  }

  protected async removeOverride(): Promise<void> {
    const key = this.selectedKey();
    const target = this.targets().find((t) => t.key === key);
    if (!target || this.permSaving()) return;
    const c = this.channel();
    this.permSaving.set(true);
    this.permsError.set('');
    try {
      if (this.persistedBits(key)) {
        await this.channelService.deleteOverride(c.guildId, c.id, target.targetId);
        this.overrides.update((list) =>
          (list ?? []).filter((o) => keyOf(o.targetType, o.targetId) !== key),
        );
      }
      this.dropLocalState(key);
      if (!target.isEveryone) {
        const everyone = this.roleStore.rolesOf(c.guildId).find((r) => r.isDefault);
        this.selectedKey.set(everyone ? keyOf('role', everyone.id) : '');
      }
    } catch {
      this.permsError.set('Could not remove the override. Check your permissions.');
    } finally {
      this.permSaving.set(false);
    }
  }

  private dropLocalState(key: string): void {
    this.editedByKey.update((m) => {
      const { [key]: _dropped, ...rest } = m;
      return rest;
    });
    this.localTargets.update((l) => l.filter((t) => keyOf(t.targetType, t.targetId) !== key));
  }
}
