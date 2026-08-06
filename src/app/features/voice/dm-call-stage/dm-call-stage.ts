import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { CallStore } from '../../../core/stores/call.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { UiAvatar } from '../../../shared/ui';
import { buildTiles } from '../call-tiles';
import { VoiceTile } from '../voice-tile/voice-tile';

/**
 * The embedded DM call stage (LiveKit Slice 4) — rendered above the message list of the open DM.
 * Connected: a fixed-height always-dark stage with the shared tile grid and round controls.
 * Ongoing call you haven't joined: a slim strip with the in-call avatars and a green Join Call
 * button. Renders nothing while the DM has no call. DMs grant every capability, so the camera/
 * screenshare buttons aren't permission-gated here. Same three-rung view ladder as {@link VoiceView}:
 * grid → in-pane focused tile + filmstrip → true OS fullscreen of the stage.
 */
@Component({
  selector: 'app-dm-call-stage',
  standalone: true,
  imports: [UiAvatar, VoiceTile],
  host: { class: 'contents' },
  templateUrl: './dm-call-stage.html',
})
export class DmCallStage {
  protected readonly voiceStore = inject(VoiceStore);
  private readonly callStore = inject(CallStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly auth = inject(AuthService);

  readonly channelId = input.required<string>();

  /** The stage element taken into true OS fullscreen (rung 3). */
  private readonly stageRoot = viewChild<ElementRef<HTMLElement>>('stageRoot');
  /** CallTile id blown up on the stage (rung 2); null = grid (rung 1). */
  protected readonly focusedTileId = signal<string | null>(null);
  /** Whether the stage is in true (OS) fullscreen — rung 3. */
  protected readonly isFullscreen = signal(false);
  /** In fullscreen, whether the members filmstrip is collapsed away. */
  protected readonly membersHidden = signal(false);

  constructor() {
    // Seed the roster once per DM open so an ongoing call shows before you join — the channel
    // group's live VoiceParticipantJoined/Left deltas keep it fresh afterwards.
    effect(() => {
      void this.voiceStore.loadRoster(this.channelId());
    });
    // Disconnecting while fullscreen drops back out — no controls exist to escape it otherwise.
    effect(() => {
      if (!this.connected() && this.isFullscreen()) {
        void document.exitFullscreen().catch(() => {});
      }
    });
  }

  protected readonly participants = computed(() =>
    this.voiceStore.participantsOf(this.channelId()),
  );

  protected readonly tiles = computed(() => buildTiles(this.participants()));

  /** The focused tile if it still exists (its owner leaving degrades back to the grid). */
  protected readonly focusedTile = computed(
    () => this.tiles().find((t) => t.id === this.focusedTileId()) ?? null,
  );

  protected readonly filmstripTiles = computed(() => {
    const focused = this.focusedTile();
    return focused ? this.tiles().filter((t) => t.id !== focused.id) : [];
  });

  /** Connected to THIS DM's call (the store allows only one active call). */
  protected readonly connected = computed(
    () => this.voiceStore.activeChannelId() === this.channelId(),
  );

  protected readonly connecting = computed(
    () => this.voiceStore.connectingChannelId() === this.channelId(),
  );

  /** Our outgoing ring is still unanswered — show the "Ringing…" pill on the stage. */
  protected readonly ringing = computed(
    () => this.callStore.outgoing()?.channelId === this.channelId(),
  );

  protected readonly visible = computed(
    () => this.connected() || this.connecting() || this.participants().length > 0,
  );

  /** Spectator strip entries — avatars/names resolve from the DM participants (self via auth). */
  protected readonly stripEntries = computed(() => {
    const dm = this.dmStore.find(this.channelId());
    const self = this.auth.currentUser();
    return this.participants().map((p) => {
      const isSelf = p.userId === self?.id;
      const dmParticipant = dm?.participants.find((x) => x.userId === p.userId);
      return {
        userId: p.userId,
        avatarKey: (isSelf ? self?.avatarKey : dmParticipant?.avatarKey) ?? null,
        name:
          this.nicknameStore.nicknameOf(p.userId) ??
          (isSelf ? self?.username : dmParticipant?.username) ??
          'Unknown',
      };
    });
  });

  protected join(): void {
    void this.voiceStore.join(this.channelId());
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

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    const fs = document.fullscreenElement !== null;
    this.isFullscreen.set(fs);
    if (!fs) this.membersHidden.set(false);
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
