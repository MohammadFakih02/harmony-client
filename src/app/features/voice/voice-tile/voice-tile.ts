import { Component, computed, inject, input, output } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { VoiceService } from '../../../core/services/voice.service';
import { MemberStore } from '../../../core/stores/member.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { UiAvatar } from '../../../shared/ui';
import { CallTile } from '../call-tiles';
import { VideoTrackDirective } from '../video-track.directive';

/**
 * One tile of a call grid — shared between the in-channel voice stage and the expanded call
 * overlay. A `camera` tile shows the participant's video when they have the camera on (avatar
 * otherwise) plus the speaking ring and name pill; a `screen` tile shows their screenshare.
 * Members resolve via the *participant's* guildId (not the selected guild), so the overlay stays
 * correct while browsing another guild mid-call. `showControls` (overlay only) adds hover
 * controls on remote tiles: mute-for-me + a local volume slider — client-side preferences that
 * never touch the remote user's state.
 */
@Component({
  selector: 'app-voice-tile',
  standalone: true,
  imports: [UiAvatar, VideoTrackDirective],
  host: { class: 'block relative min-h-0 group' },
  templateUrl: './voice-tile.html',
})
export class VoiceTile {
  protected readonly voiceStore = inject(VoiceStore);
  protected readonly voice = inject(VoiceService);
  private readonly memberStore = inject(MemberStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly auth = inject(AuthService);

  readonly tile = input.required<CallTile>();
  readonly channelId = input.required<string>();
  /** Overlay-only: reveal the per-tile local mute/volume controls on remote tiles. */
  readonly showControls = input(false);
  /** Focused rendering in the overlay (fills the stage instead of an aspect box). */
  readonly emphasized = input(false);

  readonly focusRequested = output<void>();

  protected readonly participant = computed(() =>
    this.voiceStore
      .participantsOf(this.channelId())
      .find((p) => p.userId === this.tile().userId),
  );

  protected readonly isSelf = computed(
    () => this.tile().userId === (this.auth.currentUser()?.id ?? null),
  );

  /** The attachable video track for this tile's slot (camera or screen). */
  protected readonly track = computed(() => {
    const tracks = this.voice.videoTracks().get(this.tile().userId);
    return this.tile().kind === 'screen' ? tracks?.screen : tracks?.camera;
  });

  /** Camera tiles render video only when the roster says the camera is on AND the track arrived. */
  protected readonly showVideo = computed(() => {
    if (this.tile().kind === 'screen') return this.track() !== undefined;
    return (this.participant()?.isVideoOn ?? false) && this.track() !== undefined;
  });

  protected readonly isSpeaking = computed(
    () => this.tile().kind === 'camera' && this.voiceStore.speakingUserIds().has(this.tile().userId),
  );

  /** Display name: guild nickname ?? friend nickname ?? username (same resolution as the roster). */
  protected readonly name = computed(() => {
    const member = this.member();
    return (
      member?.nickname ??
      this.nicknameStore.nicknameOf(this.tile().userId) ??
      member?.username ??
      'Unknown'
    );
  });

  protected readonly avatarKey = computed(() => this.member()?.avatarKey ?? null);

  protected readonly locallyMuted = computed(() =>
    this.voice.locallyMutedUserIds().has(this.tile().userId),
  );

  protected readonly volume = computed(() => this.voice.volumes().get(this.tile().userId) ?? 1);

  protected toggleLocalMute(event: Event): void {
    event.stopPropagation();
    this.voice.setParticipantLocalMuted(this.tile().userId, !this.locallyMuted());
  }

  protected onVolumeInput(event: Event): void {
    event.stopPropagation();
    this.voice.setParticipantVolume(this.tile().userId, Number((event.target as HTMLInputElement).value));
  }

  private member() {
    const guildId = this.participant()?.guildId;
    return guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === this.tile().userId)
      : undefined;
  }
}
