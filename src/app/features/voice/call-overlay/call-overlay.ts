import { Component, HostListener, computed, effect, inject } from '@angular/core';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { dmLabel } from '../../../core/models/direct-message.models';
import { buildTiles } from '../call-tiles';
import { VoiceTile } from '../voice-tile/voice-tile';
import { CallOverlayService } from './call-overlay.service';

/**
 * The expanded full-screen call view (LiveKit Slice 3). Mounted once in the shell (next to the
 * lightbox) so it survives channel navigation; shown while {@link CallOverlayService} says open AND
 * a call is live — it auto-vanishes when the call ends. Always-dark like the voice stage. A focused
 * tile fills the stage with the rest in a filmstrip; otherwise an auto-fit grid. Tiles here get the
 * per-tile local controls (mute-for-me + volume). ESC first clears focus, then closes.
 */
@Component({
  selector: 'app-call-overlay',
  standalone: true,
  imports: [VoiceTile],
  templateUrl: './call-overlay.html',
})
export class CallOverlay {
  protected readonly overlay = inject(CallOverlayService);
  protected readonly voiceStore = inject(VoiceStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly dmStore = inject(DmStore);
  private readonly guildStore = inject(GuildStore);
  private readonly nicknameStore = inject(NicknameStore);

  constructor() {
    // The call ending (leave, eviction, room drop) closes the overlay for good — without this,
    // a stale `isOpen` would pop the overlay straight back up on the next join.
    effect(() => {
      if (!this.voiceStore.inVoice() && this.overlay.isOpen()) this.overlay.close();
    });
  }

  protected readonly visible = computed(
    () => this.overlay.isOpen() && this.voiceStore.inVoice(),
  );

  /** The connected channel — searched across every loaded guild's channel list (voice-bar pattern). */
  protected readonly activeChannel = computed(() => {
    const id = this.voiceStore.activeChannelId();
    if (!id) return null;
    for (const channels of Object.values(this.channelStore.channelsByGuild())) {
      const match = channels.find((c) => c.id === id);
      if (match) return match;
    }
    return null;
  });

  /** The active DM when the call is a DM call (no guild channel matches — LiveKit Slice 4). */
  private readonly activeDm = computed(() => {
    const id = this.voiceStore.activeChannelId();
    return id && !this.activeChannel() ? this.dmStore.find(id) : undefined;
  });

  /** Header label: the voice channel's name, or the DM's label for a DM call. */
  protected readonly activeLabel = computed(() => {
    const channel = this.activeChannel();
    if (channel) return channel.name;
    const dm = this.activeDm();
    return dm
      ? dmLabel(dm, (p) => this.nicknameStore.nicknameOf(p.userId) ?? p.username)
      : 'Voice';
  });

  /** Header context: the owning guild's name, or the DM kind. */
  protected readonly activeContext = computed(() => {
    const guildId = this.activeChannel()?.guildId;
    if (guildId) return this.guildStore.guilds().find((g) => g.id === guildId)?.name ?? null;
    const dm = this.activeDm();
    return dm ? (dm.isGroup ? 'Group DM' : 'Direct Message') : null;
  });

  protected readonly tiles = computed(() => {
    const id = this.voiceStore.activeChannelId();
    return id ? buildTiles(this.voiceStore.participantsByChannel()[id] ?? []) : [];
  });

  /** The focused tile, if it still exists (its owner leaving degrades back to the grid). */
  protected readonly focusedTile = computed(
    () => this.tiles().find((t) => t.id === this.overlay.focusedTileId()) ?? null,
  );

  protected readonly filmstripTiles = computed(() => {
    const focused = this.focusedTile();
    return focused ? this.tiles().filter((t) => t.id !== focused.id) : [];
  });

  // Capabilities belong to the *selected* channel — only authoritative when that IS the call
  // channel AND it's a guild channel (DM routes never load capabilities, so a stale guild's caps
  // must not gate a DM call — DMs grant everything); optimistic-true otherwise (the LiveKit token
  // + hub clamp are the real enforcement).
  private readonly capsApply = computed(
    () =>
      this.activeChannel() !== null &&
      this.channelStore.selectedChannelId() === this.voiceStore.activeChannelId(),
  );

  protected readonly canUseVideo = computed(
    () => !this.capsApply() || (this.channelStore.currentCapabilities()?.canUseVideo ?? true),
  );

  protected readonly canStream = computed(
    () => !this.capsApply() || (this.channelStore.currentCapabilities()?.canStream ?? true),
  );

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.visible()) return;
    if (this.overlay.focusedTileId()) this.overlay.clearFocus();
    else this.overlay.close();
  }

  protected toggleFocus(tileId: string): void {
    this.overlay.toggleFocus(tileId);
  }

  protected collapse(): void {
    this.overlay.close();
  }

  protected toggleMute(): void {
    this.voiceStore.toggleMute();
  }

  protected toggleDeafen(): void {
    this.voiceStore.toggleDeafen();
  }

  protected toggleCamera(): void {
    void this.voiceStore.toggleCamera();
  }

  protected toggleScreenShare(): void {
    void this.voiceStore.toggleScreenShare();
  }

  protected disconnect(): void {
    void this.voiceStore.leave();
  }
}
