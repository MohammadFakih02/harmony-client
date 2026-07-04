import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ForwardService, ForwardTarget } from '../../../core/services/forward.service';
import { ToastService } from '../../../core/services/toast.service';
import { GuildStore } from '../../../core/stores/guild.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { dmLabel, dmPeer } from '../../../core/models/direct-message.models';
import { MessageResponse } from '../../../core/models/message.models';
import { UiAvatar, UiModal } from '../../../shared/ui';

/** One selectable destination shown in the picker. */
interface TargetRow {
  channelId: string;
  guildId: string | null;
  label: string;
  /** DM peer avatar (null for guild channels, which show a # glyph instead). */
  avatarKey: string | null;
  isDm: boolean;
}

interface TargetGroup {
  title: string;
  rows: TargetRow[];
}

const FORWARDABLE_CHANNEL_TYPES = new Set(['text', 'announcement']);

/**
 * Forward picker: choose one or more destination channels/DMs and an optional note, then re-send the
 * message to each (re-uploading any images). Rendered behind a parent `@if`; emits `close`.
 */
@Component({
  selector: 'app-forward-modal',
  standalone: true,
  imports: [FormsModule, UiAvatar, UiModal],
  templateUrl: './forward-modal.html',
})
export class ForwardModal implements OnInit {
  private readonly forwardService = inject(ForwardService);
  private readonly toast = inject(ToastService);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);

  readonly message = input.required<MessageResponse>();
  readonly close = output<void>();

  protected readonly loading = signal(true);
  protected readonly sending = signal(false);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly note = signal('');
  protected readonly selected = signal<Set<string>>(new Set());

  async ngOnInit(): Promise<void> {
    try {
      // The picker spans every guild, but channels are only cached for visited guilds — load the rest.
      const guilds = this.guildStore.guilds();
      await Promise.all(
        guilds
          .filter((g) => !this.channelStore.channelsByGuild()[g.id])
          .map((g) => this.channelStore.loadChannels(g.id)),
      );
      if (!this.dmStore.dms().length) await this.dmStore.load();
    } finally {
      this.loading.set(false);
    }
  }

  /** All destinations, grouped (DMs first, then one section per guild), filtered by the search box. */
  protected readonly groups = computed<TargetGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    const match = (label: string) => !q || label.toLowerCase().includes(q);
    const groups: TargetGroup[] = [];

    const dmRows: TargetRow[] = this.dmStore
      .dms()
      .map((dm) => {
        const peer = dmPeer(dm);
        return {
          channelId: dm.channelId,
          guildId: null,
          label: dmLabel(dm, (p) => this.nicknameStore.nicknameOf(p.userId) ?? p.username),
          avatarKey: peer?.avatarKey ?? null,
          isDm: true,
        };
      })
      .filter((r) => match(r.label));
    if (dmRows.length) groups.push({ title: 'Direct Messages', rows: dmRows });

    const channelsByGuild = this.channelStore.channelsByGuild();
    for (const guild of this.guildStore.guilds()) {
      const rows: TargetRow[] = (channelsByGuild[guild.id] ?? [])
        .filter((c) => FORWARDABLE_CHANNEL_TYPES.has(c.type))
        .sort((a, b) => a.position - b.position)
        .map((c) => ({
          channelId: c.id,
          guildId: guild.id,
          label: c.name,
          avatarKey: null,
          isDm: false,
        }))
        .filter((r) => match(r.label) || match(guild.name));
      if (rows.length) groups.push({ title: guild.name, rows });
    }

    return groups;
  });

  // channelId → target, so the Send handler can resolve the guild for each selected id.
  private readonly targetIndex = computed<Map<string, ForwardTarget>>(() => {
    const map = new Map<string, ForwardTarget>();
    for (const group of this.groups()) {
      for (const row of group.rows) {
        map.set(row.channelId, { guildId: row.guildId, channelId: row.channelId });
      }
    }
    return map;
  });

  protected isSelected(channelId: string): boolean {
    return this.selected().has(channelId);
  }

  protected toggle(channelId: string): void {
    const next = new Set(this.selected());
    next.has(channelId) ? next.delete(channelId) : next.add(channelId);
    this.selected.set(next);
  }

  protected readonly canSend = computed(() => this.selected().size > 0 && !this.sending());

  async send(): Promise<void> {
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set('');

    const msg = this.message();
    const source = {
      guildId: msg.guildId,
      channelId: msg.channelId,
      content: msg.content,
      attachmentIds: msg.attachmentIds,
    };
    const note = this.note().trim() || undefined;
    const targets = [...this.selected()]
      .map((id) => this.targetIndex().get(id))
      .filter((t): t is ForwardTarget => t != null);

    const results = await Promise.allSettled(
      targets.map((target) => this.forwardService.forward(source, target, note)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const sent = results.length - failed;

    this.sending.set(false);
    if (sent > 0) {
      this.toast.info(`Forwarded to ${sent} ${sent === 1 ? 'channel' : 'channels'}`);
    }
    if (failed > 0 && sent === 0) {
      this.error.set('Could not forward the message. You may not be able to post there.');
      return; // keep the modal open so the user can retry / adjust
    }
    this.close.emit();
  }
}
