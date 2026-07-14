import { Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { RoleService } from '../../../core/services/role.service';
import { ToastService } from '../../../core/services/toast.service';
import { VoiceService } from '../../../core/services/voice.service';
import { BlockStore } from '../../../core/stores/block.store';
import { FriendStore } from '../../../core/stores/friend.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { DmStore } from '../../../core/stores/dm.store';
import { MemberStore } from '../../../core/stores/member.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { RoleStore } from '../../../core/stores/role.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { UiAvatar, ConfirmService } from '../../../shared/ui';
import { CallTile } from '../call-tiles';
import { VideoTrackDirective } from '../video-track.directive';
import { buildVoiceParticipantMenu, VoiceMenuDeps } from '../voice-user-menu';

/**
 * One tile of a call grid — shared between the in-channel voice stage and the expanded call
 * overlay. A `camera` tile shows the participant's video when they have the camera on (avatar
 * otherwise) plus the speaking ring and name pill; a `screen` tile shows their screenshare.
 * Members resolve via the *participant's* guildId (not the selected guild), so the overlay stays
 * correct while browsing another guild mid-call. `showControls` (overlay + connected stage) adds
 * hover controls on remote tiles: mute-for-me + a local volume slider — client-side preferences
 * that never touch the remote user's state.
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
  private readonly dmStore = inject(DmStore);
  private readonly memberStore = inject(MemberStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly auth = inject(AuthService);
  private readonly channelStore = inject(ChannelStore);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly voiceMenuDeps: VoiceMenuDeps = {
    memberStore: this.memberStore,
    roleStore: inject(RoleStore),
    roleService: inject(RoleService),
    dmStore: this.dmStore,
    friendStore: inject(FriendStore),
    blockStore: inject(BlockStore),
    muteStore: inject(MuteStore),
    profileModal: inject(ProfileModalService),
    toast: inject(ToastService),
    router: inject(Router),
    auth: this.auth,
    confirm: inject(ConfirmService),
    voiceStore: this.voiceStore,
    voiceService: this.voice,
  };

  readonly tile = input.required<CallTile>();
  readonly channelId = input.required<string>();
  /** Reveal the per-tile local mute/volume controls on remote tiles (overlay + connected stage). */
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

  /**
   * Camera tiles render video only when the roster says the camera is on AND the track arrived
   * (and the viewer hasn't hidden it). Screen tiles are click-to-watch (Discord-style): remote
   * streams stay an inert LIVE tile until the viewer opts in — an unattached track is paused by
   * adaptiveStream, so not watching costs no bandwidth.
   */
  protected readonly showVideo = computed(() => {
    if (this.tile().kind === 'screen') {
      return this.track() !== undefined && (this.isSelf() || this.voiceStore.isWatchingStream(this.tile().userId));
    }
    return (
      (this.participant()?.isVideoOn ?? false) &&
      this.track() !== undefined &&
      (this.isSelf() || !this.voiceStore.isVideoHidden(this.tile().userId))
    );
  });

  /** Remote screen tile the viewer hasn't opted into yet — renders the Watch Stream prompt. */
  protected readonly awaitingWatch = computed(
    () =>
      this.tile().kind === 'screen' &&
      !this.isSelf() &&
      !this.voiceStore.isWatchingStream(this.tile().userId),
  );

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
      this.dmParticipant()?.username ??
      (this.isSelf() ? this.auth.currentUser()?.username : undefined) ??
      'Unknown'
    );
  });

  protected readonly avatarKey = computed(
    () =>
      this.member()?.avatarKey ??
      this.dmParticipant()?.avatarKey ??
      (this.isSelf() ? this.auth.currentUser()?.avatarKey : undefined) ??
      null,
  );

  protected readonly locallyMuted = computed(() =>
    this.voice.locallyMutedUserIds().has(this.tile().userId),
  );

  // A screen tile's slider governs the screen-share audio; a camera/avatar tile's governs the mic —
  // the two are independent (VoiceService keeps a separate volume map per source).
  protected readonly volume = computed(() => {
    const userId = this.tile().userId;
    return this.tile().kind === 'screen'
      ? (this.voice.screenVolumes().get(userId) ?? 1)
      : (this.voice.volumes().get(userId) ?? 1);
  });

  protected toggleLocalMute(event: Event): void {
    event.stopPropagation();
    this.voice.setParticipantLocalMuted(this.tile().userId, !this.locallyMuted());
  }

  protected onVolumeInput(event: Event): void {
    event.stopPropagation();
    const value = Number((event.target as HTMLInputElement).value);
    if (this.tile().kind === 'screen') {
      this.voice.setParticipantScreenVolume(this.tile().userId, value);
    } else {
      this.voice.setParticipantVolume(this.tile().userId, value);
    }
  }

  protected watchStream(event: Event): void {
    event.stopPropagation();
    if (!this.voiceStore.isWatchingStream(this.tile().userId)) {
      this.voiceStore.toggleWatchStream(this.tile().userId);
    }
  }

  /** Right-click anywhere on the tile → the voice participant menu (local controls + moderation). */
  protected onContextMenu(event: MouseEvent): void {
    const p = this.participant();
    if (!p) return;
    const guildId = p.guildId;
    const member = guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === p.userId)
      : undefined;
    const voiceChannels = guildId
      ? (this.channelStore.channelsByGuild()[guildId] ?? []).filter((c) => c.type === 'voice')
      : [];
    this.contextMenu.open(
      event,
      buildVoiceParticipantMenu(
        this.voiceMenuDeps,
        {
          userId: p.userId,
          guildId,
          username: member?.username ?? this.name(),
          member,
          caps: guildId ? this.memberStore.capabilitiesOf(guildId) : null,
        },
        p,
        voiceChannels,
      ),
    );
  }

  private member() {
    const guildId = this.participant()?.guildId;
    return guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === this.tile().userId)
      : undefined;
  }

  /** DM-call fallback: resolve the user from the DM's participant list (self isn't in it). */
  private dmParticipant() {
    if (this.participant()?.guildId) return undefined;
    return this.dmStore
      .find(this.channelId())
      ?.participants.find((p) => p.userId === this.tile().userId);
  }
}
