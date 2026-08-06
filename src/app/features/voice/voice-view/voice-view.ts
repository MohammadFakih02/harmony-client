import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ChannelStore } from '../../../core/stores/channel.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { buildTiles } from '../call-tiles';
import { VoiceTile } from '../voice-tile/voice-tile';

/**
 * The voice channel stage (LiveKit Slices 2+3) — rendered in the main content pane instead of a
 * chat when the selected channel is a voice channel. Discord-style: an always-dark stage (independent
 * of the app theme) with one tile per connected participant (plus screenshare tiles), a Join button
 * while spectating, and round controls while connected. Media + roster live in VoiceStore.
 *
 * Three-rung view ladder (Discord-style), all driven from here so no rung hijacks another:
 *   1. grid — every tile equal, in the content pane (server/channel sidebars visible);
 *   2. focused — click a tile to blow it up with the rest as a filmstrip, STILL in the pane
 *      (sidebars visible), i.e. "most of the window" but not fullscreen;
 *   3. fullscreen — a true OS fullscreen of the stage element, with the filmstrip of members along
 *      the bottom which can be hidden. requestFullscreen must run inside the click gesture, so it
 *      targets the always-present stage element (no shell overlay to hand off to).
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

  /** The stage element taken into true OS fullscreen (rung 3). */
  private readonly stageRoot = viewChild<ElementRef<HTMLElement>>('stageRoot');

  /** CallTile id blown up on the stage (rung 2); null = grid (rung 1). */
  protected readonly focusedTileId = signal<string | null>(null);
  /** Whether the stage is in true (OS) fullscreen — rung 3. */
  protected readonly isFullscreen = signal(false);
  /** In fullscreen, whether the members filmstrip is collapsed away. */
  protected readonly membersHidden = signal(false);

  constructor() {
    // Disconnecting while fullscreen (leave/eviction) drops back out of fullscreen — otherwise the
    // OS-fullscreen stage would linger with no controls to escape it.
    effect(() => {
      if (!this.connected() && this.isFullscreen()) {
        void document.exitFullscreen().catch(() => {});
      }
    });
  }

  protected readonly channel = computed(() => this.channelStore.selectedChannel());

  protected readonly participants = computed(() => {
    const id = this.channel()?.id;
    return id ? this.voiceStore.participantsByChannel()[id] ?? [] : [];
  });

  protected readonly tiles = computed(() => buildTiles(this.participants()));

  /** The focused tile if it still exists (its owner leaving degrades back to the grid). */
  protected readonly focusedTile = computed(
    () => this.tiles().find((t) => t.id === this.focusedTileId()) ?? null,
  );

  protected readonly filmstripTiles = computed(() => {
    const focused = this.focusedTile();
    return focused ? this.tiles().filter((t) => t.id !== focused.id) : [];
  });

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

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    const fs = document.fullscreenElement !== null;
    this.isFullscreen.set(fs);
    if (!fs) this.membersHidden.set(false);
  }

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

  /** Rung 1 ↔ 2: focus a tile, or unfocus if it's already the focused one. In-pane; no fullscreen. */
  protected toggleFocus(tileId: string): void {
    this.focusedTileId.update((cur) => (cur === tileId ? null : tileId));
  }

  /** Rung 3: true OS fullscreen of the stage. Best-effort (may be denied); called in the gesture. */
  protected async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.stageRoot()?.nativeElement.requestFullscreen();
    } catch {
      /* fullscreen unavailable / denied — leave the in-pane view as-is */
    }
  }

  protected toggleMembers(): void {
    this.membersHidden.update((v) => !v);
  }
}
