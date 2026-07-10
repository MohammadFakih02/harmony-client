import { Component, computed, inject } from '@angular/core';
import { ChannelStore } from '../../../core/stores/channel.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { buildTiles } from '../call-tiles';
import { CallOverlayService } from '../call-overlay/call-overlay.service';
import { VoiceTile } from '../voice-tile/voice-tile';

/**
 * The voice channel stage (LiveKit Slices 2+3) — rendered in the main content pane instead of a
 * chat when the selected channel is a voice channel. Discord-style: an always-dark stage (independent
 * of the app theme) with one tile per connected participant (plus screenshare tiles), a Join button
 * while spectating, and round camera / screenshare / mute / deafen / expand / disconnect controls
 * while connected. Media + roster live in VoiceStore; clicking a tile expands the call overlay
 * focused on it.
 */
@Component({
  selector: 'app-voice-view',
  standalone: true,
  imports: [VoiceTile],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  templateUrl: './voice-view.html',
})
export class VoiceView {
  protected readonly voiceStore = inject(VoiceStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly overlay = inject(CallOverlayService);

  protected readonly channel = computed(() => this.channelStore.selectedChannel());

  protected readonly participants = computed(() => {
    const id = this.channel()?.id;
    return id ? this.voiceStore.participantsByChannel()[id] ?? [] : [];
  });

  protected readonly tiles = computed(() => buildTiles(this.participants()));

  /** Connected to THIS channel (the store allows only one active call). */
  protected readonly connected = computed(
    () => this.voiceStore.activeChannelId() === this.channel()?.id,
  );

  protected readonly connecting = computed(
    () => this.voiceStore.connectingChannelId() === this.channel()?.id,
  );

  // Optimistic-true while capabilities are still loading — the LiveKit token + hub clamp are the
  // real enforcement; this only decides whether the buttons render.
  protected readonly canUseVideo = computed(
    () => this.channelStore.currentCapabilities()?.canUseVideo ?? true,
  );

  protected readonly canStream = computed(
    () => this.channelStore.currentCapabilities()?.canStream ?? true,
  );

  protected join(): void {
    const channel = this.channel();
    if (channel) void this.voiceStore.join(channel.id);
  }

  protected leave(): void {
    void this.voiceStore.leave();
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

  protected expand(tileId?: string): void {
    if (this.connected()) this.overlay.open(tileId);
  }
}
