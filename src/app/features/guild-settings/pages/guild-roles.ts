import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoleStore } from '../../../core/stores/role.store';
import { Role, roleColorHex } from '../../../core/models/role.models';
import {
  PERMISSION_GROUPS,
  ROLE_COLOR_PRESETS,
  hasBit,
} from '../../../core/models/permission.constants';

/**
 * Role management for a guild (ManageRoles): a role list on the left (create + reorder), an editor on
 * the right (name, color, hoist/mentionable, the permission grid). Save is explicit. The backend
 * re-validates hierarchy + the grant rule, so a forbidden change surfaces as an inline error.
 * A pane of the guild-settings page (§5.24 admin-tools consolidation).
 */
@Component({
  selector: 'app-guild-roles',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './guild-roles.html',
})
export class GuildRoles implements OnInit {
  private readonly roleStore = inject(RoleStore);

  readonly guildId = input.required<string>();

  protected readonly groups = PERMISSION_GROUPS;
  protected readonly colorPresets = ROLE_COLOR_PRESETS;
  protected readonly colorHex = roleColorHex;
  protected readonly hasBit = hasBit;

  protected readonly roles = computed(() => this.roleStore.rolesOf(this.guildId()));
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(
    () => this.roles().find((r) => r.id === this.selectedId()) ?? null,
  );

  // Editable draft for the selected role.
  protected readonly name = signal('');
  protected readonly color = signal(0);
  protected readonly bits = signal(0);
  protected readonly hoisted = signal(false);
  protected readonly mentionable = signal(false);

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly dirty = computed(() => {
    const r = this.selected();
    if (!r) return false;
    return (
      this.name() !== r.name ||
      this.color() !== r.color ||
      this.bits() !== r.permissionBits ||
      this.hoisted() !== r.isHoisted ||
      this.mentionable() !== r.isMentionable
    );
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.roleStore.reload(this.guildId());
    } catch {
      this.error.set('Could not load roles.');
    }
    if (this.roles().length) this.select(this.roles()[0]);
  }

  protected select(role: Role): void {
    this.error.set('');
    this.selectedId.set(role.id);
    this.name.set(role.name);
    this.color.set(role.color);
    this.bits.set(role.permissionBits);
    this.hoisted.set(role.isHoisted);
    this.mentionable.set(role.isMentionable);
  }

  protected togglePerm(bit: number): void {
    this.bits.update((b) => (hasBit(b, bit) ? b & ~bit : b | bit));
  }

  protected async createRole(): Promise<void> {
    this.error.set('');
    try {
      const role = await this.roleStore.create(this.guildId(), { name: 'new role' });
      this.select(role);
    } catch {
      this.error.set('Could not create the role. Check your permissions.');
    }
  }

  protected async save(): Promise<void> {
    const r = this.selected();
    if (!r || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.roleStore.update(this.guildId(), r.id, {
        name: r.isDefault ? undefined : this.name(),
        color: this.color(),
        permissionBits: this.bits(),
        isHoisted: this.hoisted(),
        isMentionable: this.mentionable(),
      });
    } catch {
      this.error.set('Save failed — you can only grant permissions you have, on roles below yours.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteRole(): Promise<void> {
    const r = this.selected();
    if (!r || r.isDefault) return;
    this.error.set('');
    try {
      await this.roleStore.remove(this.guildId(), r.id);
      this.selectedId.set(null);
      if (this.roles().length) this.select(this.roles()[0]);
    } catch {
      this.error.set('Could not delete the role.');
    }
  }

  protected async move(role: Role, dir: 'up' | 'down'): Promise<void> {
    const ordered = this.roles().filter((r) => !r.isDefault); // already position-desc
    const idx = ordered.findIndex((r) => r.id === role.id);
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;

    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    // Re-number top→bottom so the new visual order sticks (top = highest rank).
    const positions = ordered.map((r, i) => ({ roleId: r.id, position: ordered.length - i }));
    try {
      await this.roleStore.reorder(this.guildId(), positions);
    } catch {
      this.error.set('Could not reorder — you can only move roles below your highest role.');
    }
  }
}
