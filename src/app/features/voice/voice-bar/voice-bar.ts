import { Component, computed, inject } from '@angular/core';
import { VoiceStore } from '../../../core/stores/voice.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { UiIconButton } from '../../../shared/ui';

/**
 * The connected-voice control bar (LiveKit Slice 2 — audio). Rendered above the user deck in the
 * channel sidebar only while connected to a voice channel. Shows the channel/guild you're in and the
 * mute / deafen / disconnect controls; the roster itself lives inline under the channel row.
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
  private readonly guildStore = inject(GuildStore);

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

  /** The name of the guild that owns the active voice channel (for the "in ServerName" line). */
  protected readonly activeGuildName = computed(() => {
    const guildId = this.activeChannel()?.guildId;
    return guildId ? this.guildStore.guilds().find((g) => g.id === guildId)?.name ?? null : null;
  });

  protected toggleMute(): void {
    this.voiceStore.toggleMute();
  }

  protected toggleDeafen(): void {
    this.voiceStore.toggleDeafen();
  }

  protected disconnect(): void {
    void this.voiceStore.leave();
  }
}
