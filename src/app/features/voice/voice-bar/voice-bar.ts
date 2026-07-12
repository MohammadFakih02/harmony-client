import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { VoiceStore } from '../../../core/stores/voice.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { dmLabel } from '../../../core/models/direct-message.models';
import { UiIconButton } from '../../../shared/ui';

/**
 * The connected-voice control bar (LiveKit Slice 2 — audio). Rendered above the user deck in the
 * channel sidebar only while connected to a voice channel. Shows the channel/guild you're in (click
 * navigates back to the call) and the mute / deafen / camera / screenshare / disconnect controls;
 * the roster itself lives inline under the channel row.
 */
@Component({
  selector: 'app-voice-bar',
  standalone: true,
  imports: [UiIconButton],
  templateUrl: './voice-bar.html',
})
export class VoiceBar {
  protected readonly voiceStore = inject(VoiceStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly dmStore = inject(DmStore);
  private readonly guildStore = inject(GuildStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly router = inject(Router);

  /** The channel we're connected to — or connecting to (searched across every loaded guild's channel list). */
  protected readonly activeChannel = computed(() => {
    const id = this.voiceStore.activeChannelId() ?? this.voiceStore.connectingChannelId();
    if (!id) return null;
    for (const channels of Object.values(this.channelStore.channelsByGuild())) {
      const match = channels.find((c) => c.id === id);
      if (match) return match;
    }
    return null;
  });

  /** The active DM when the call is a DM call (no guild channel matches — LiveKit Slice 4). */
  private readonly activeDm = computed(() => {
    const id = this.voiceStore.activeChannelId() ?? this.voiceStore.connectingChannelId();
    return id && !this.activeChannel() ? this.dmStore.find(id) : undefined;
  });

  /** What we're connected to: the voice channel's name, or the DM's label for a DM call. */
  protected readonly activeLabel = computed(() => {
    const channel = this.activeChannel();
    if (channel) return channel.name;
    const dm = this.activeDm();
    return dm
      ? dmLabel(dm, (p) => this.nicknameStore.nicknameOf(p.userId) ?? p.username)
      : 'Voice';
  });

  /** The context line: owning guild's name, or the DM kind (for the "/ ServerName" suffix). */
  protected readonly activeContext = computed(() => {
    const guildId = this.activeChannel()?.guildId;
    if (guildId) return this.guildStore.guilds().find((g) => g.id === guildId)?.name ?? null;
    const dm = this.activeDm();
    return dm ? (dm.isGroup ? 'Group DM' : 'Direct Message') : null;
  });

  // Capabilities gate the camera/screenshare buttons only when the *selected* channel IS the call
  // channel and it's a guild channel (same rule as the call overlay — DM calls grant everything,
  // and a stale guild's caps must never gate a DM call). The LiveKit token + hub clamp are the
  // real enforcement; this only keeps the buttons honest.
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

  /** Clicking the label navigates back to where the call lives (voice stage or the DM). */
  protected goToCall(): void {
    const channel = this.activeChannel();
    if (channel?.guildId) {
      void this.router.navigate(['/app/guilds', channel.guildId, 'channels', channel.id]);
      return;
    }
    const dm = this.activeDm();
    if (dm) void this.router.navigate(['/app/dm', dm.channelId]);
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
