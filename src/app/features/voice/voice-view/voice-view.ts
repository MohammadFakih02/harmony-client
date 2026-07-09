import { Component, computed, inject } from '@angular/core';
import { ChannelStore } from '../../../core/stores/channel.store';
import { GuildStore } from '../../../core/stores/guild.store';
import { MemberStore } from '../../../core/stores/member.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { VoiceStore } from '../../../core/stores/voice.store';
import { UiAvatar } from '../../../shared/ui';

/**
 * The voice channel stage (LiveKit Slice 2 polish) — rendered in the main content pane instead of a
 * chat when the selected channel is a voice channel. Discord-style: an always-dark stage (independent
 * of the app theme) with one tile per connected participant, a Join button while spectating, and
 * round mute / deafen / disconnect controls while connected. Media + roster live in VoiceStore.
 */
@Component({
  selector: 'app-voice-view',
  standalone: true,
  imports: [UiAvatar],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  templateUrl: './voice-view.html',
})
export class VoiceView {
  protected readonly voiceStore = inject(VoiceStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly guildStore = inject(GuildStore);
  private readonly memberStore = inject(MemberStore);
  private readonly nicknameStore = inject(NicknameStore);

  protected readonly channel = computed(() => this.channelStore.selectedChannel());

  protected readonly participants = computed(() => {
    const id = this.channel()?.id;
    return id ? this.voiceStore.participantsByChannel()[id] ?? [] : [];
  });

  /** Connected to THIS channel (the store allows only one active call). */
  protected readonly connected = computed(
    () => this.voiceStore.activeChannelId() === this.channel()?.id,
  );

  protected readonly connecting = computed(
    () => this.voiceStore.connectingChannelId() === this.channel()?.id,
  );

  /** Display name: guild nickname ?? friend nickname ?? username (same resolution as the sidebar roster). */
  protected name(userId: string): string {
    const member = this.member(userId);
    return member?.nickname ?? this.nicknameStore.nicknameOf(userId) ?? member?.username ?? 'Unknown';
  }

  protected avatar(userId: string): string | null {
    return this.member(userId)?.avatarKey ?? null;
  }

  protected isSpeaking(userId: string): boolean {
    return this.voiceStore.speakingUserIds().has(userId);
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

  private member(userId: string) {
    const guildId = this.guildStore.selectedGuildId();
    return guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === userId)
      : undefined;
  }
}
