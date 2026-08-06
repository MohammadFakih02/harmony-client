import { ContextMenuEntry } from '../../core/models/context-menu.models';
import { Channel } from '../../core/models/channel.models';
import { VoiceParticipant } from '../../core/models/voice.models';
import { VoiceStore } from '../../core/stores/voice.store';
import { VoiceService } from '../../core/services/voice.service';
import { buildUserMenu, UserMenuDeps, UserMenuTarget } from '../shell/user-context-menu';

/** Extra deps the voice sections need on top of the shared user-menu core. */
export interface VoiceMenuDeps extends UserMenuDeps {
  voiceStore: InstanceType<typeof VoiceStore>;
  voiceService: VoiceService;
}


/**
 * Context menu for a voice participant (sidebar roster rows + stage/overlay tiles). Prepends the
 * voice-local section (mute-for-me, volume, hide video, watch stream) and — caps-gated — the voice
 * moderation section (server mute/deafen, move to) onto the shared {@link buildUserMenu} core.
 * Moderation calls rethrow from the store; failures surface as a toast, the roster updates only via
 * the server echo (nothing optimistic).
 */
export function buildVoiceParticipantMenu(
  deps: VoiceMenuDeps,
  target: UserMenuTarget,
  participant: VoiceParticipant,
  guildVoiceChannels: Channel[],
): ContextMenuEntry[] {
  const { voiceStore, voiceService } = deps;
  const userId = participant.userId;
  const isSelf = userId === deps.auth.currentUser()?.id;

  const voiceSection: ContextMenuEntry[] = [];

  if (!isSelf) {
    voiceSection.push(
      {
        label: 'Mute for Me',
        icon: 'fa-volume-xmark',
        keepOpen: true,
        checked: () => voiceService.locallyMutedUserIds().has(userId),
        action: () =>
          voiceService.setParticipantLocalMuted(userId, !voiceService.locallyMutedUserIds().has(userId)),
      },
      {
        label: participant.isStreaming ? 'Voice Volume' : 'Volume',
        icon: 'fa-volume-high',
        slider: {
          value: () => voiceService.volumes().get(userId) ?? 1,
          onInput: (v) => voiceService.setParticipantVolume(userId, v),
        },
      },
    );
    if (participant.isStreaming) {
      voiceSection.push({
        label: 'Stream Volume',
        icon: 'fa-display',
        slider: {
          value: () => voiceService.screenVolumes().get(userId) ?? 1,
          onInput: (v) => voiceService.setParticipantScreenVolume(userId, v),
        },
      });
    }
    if (participant.isVideoOn) {
      voiceSection.push({
        label: voiceStore.isVideoHidden(userId) ? 'Show Video' : 'Hide Video for Me',
        icon: voiceStore.isVideoHidden(userId) ? 'fa-video' : 'fa-video-slash',
        action: () => voiceStore.toggleHideVideo(userId),
      });
    }
    if (participant.isStreaming) {
      voiceSection.push({
        label: voiceStore.isWatchingStream(userId) ? 'Stop Watching Stream' : 'Watch Stream',
        icon: 'fa-display',
        action: () => voiceStore.toggleWatchStream(userId),
      });
    }
  }

  // Voice moderation — guild rooms only, gated per-flag on the caller's capabilities. The server
  // re-checks everything; the gates here just keep the menu honest.
  const modSection: ContextMenuEntry[] = [];
  const caps = target.caps;
  const inGuildRoom = !!target.guildId;
  const modTargetOk = inGuildRoom && !isSelf && !target.member?.isOwner;
  if (modTargetOk && caps) {
    if (caps.canMuteMembers) {
      modSection.push({
        label: participant.isServerMuted ? 'Server Unmute' : 'Server Mute',
        icon: 'fa-microphone-slash',
        action: () => runVoiceMod(deps, voiceStore.serverMute(userId, !participant.isServerMuted)),
      });
    }
    if (caps.canDeafenMembers) {
      modSection.push({
        label: participant.isServerDeafened ? 'Server Undeafen' : 'Server Deafen',
        icon: 'fa-ear-deaf',
        action: () => runVoiceMod(deps, voiceStore.serverDeafen(userId, !participant.isServerDeafened)),
      });
    }
    if (caps.canMoveMembers) {
      const destinations = guildVoiceChannels.filter((c) => c.id !== participant.channelId);
      if (destinations.length > 0) {
        modSection.push({
          label: 'Move To',
          icon: 'fa-right-left',
          children: destinations.map((c) => ({
            label: c.name,
            icon: 'fa-volume-high',
            action: () => runVoiceMod(deps, voiceStore.moveParticipant(userId, c.id)),
          })),
        });
      }
    }
  }

  const entries: ContextMenuEntry[] = [];
  if (voiceSection.length > 0) entries.push(...voiceSection, { separator: true });
  if (modSection.length > 0) entries.push(...modSection, { separator: true });
  entries.push(...buildUserMenu(deps, target));
  return entries;
}

/**
 * Awaits a voice moderation invoke and toasts the hub's rejection reason (permission/room checks).
 * Shared with the sidebar's drag-to-move (same failure surface: a HubException per rejected move).
 */
export async function runVoiceMod(deps: VoiceMenuDeps, action: Promise<void>): Promise<void> {
  try {
    await action;
  } catch (err) {
    const message = err instanceof Error ? extractHubError(err.message) : null;
    deps.toast.info(message ?? 'Action failed. Check your permissions and try again.', 'fa-triangle-exclamation');
  }
}

/** SignalR wraps HubException text as "...HubException: <reason>" — pull out the readable part. */
function extractHubError(raw: string): string | null {
  const marker = 'HubException: ';
  const idx = raw.lastIndexOf(marker);
  return idx >= 0 ? raw.slice(idx + marker.length).trim() : null;
}
