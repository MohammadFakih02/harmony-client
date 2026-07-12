import { Component, computed, effect, inject, input } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { CallStore } from '../../../core/stores/call.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { UiAvatar } from '../../../shared/ui';
import { buildTiles } from '../call-tiles';
import { CallOverlayService } from '../call-overlay/call-overlay.service';
import { VoiceTile } from '../voice-tile/voice-tile';

/**
 * The embedded DM call stage (LiveKit Slice 4) — rendered above the message list of the open DM.
 * Connected: a fixed-height always-dark stage with the shared tile grid and round controls
 * (expand hands off to the call overlay). Ongoing call you haven't joined: a slim strip with the
 * in-call avatars and a green Join Call button. Renders nothing while the DM has no call.
 * DMs grant every capability, so the camera/screenshare buttons aren't permission-gated here.
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
  private readonly overlay = inject(CallOverlayService);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly auth = inject(AuthService);

  readonly channelId = input.required<string>();

  constructor() {
    // Seed the roster once per DM open so an ongoing call shows before you join — the channel
    // group's live VoiceParticipantJoined/Left deltas keep it fresh afterwards.
    effect(() => {
      void this.voiceStore.loadRoster(this.channelId());
    });
  }

  protected readonly participants = computed(() =>
    this.voiceStore.participantsOf(this.channelId()),
  );

  protected readonly tiles = computed(() => buildTiles(this.participants()));

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

  protected expand(tileId?: string): void {
    if (this.connected()) this.overlay.open(tileId);
  }
}
