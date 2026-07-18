import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { Channel } from '../models/channel.models';
import { MessageFailedPayload, MessageResponse, UnreadCountPayload } from '../models/message.models';
import { FriendUserPayload } from '../models/friend.models';
import { GatewayEvent } from './gateway-events';
import { GuildMember } from '../models/member.models';
import { Role } from '../models/role.models';

// The small per-event shapes now live with the union in ./gateway-events.
export type { MessageEditedEvent, MessagePinEvent, TypingEvent } from './gateway-events';

/**
 * Thin wrapper over a SignalR HubConnection. Every server→client handler coerces its raw payload
 * (Snowflake ids → strings, longs → numbers) and forwards it to a single `emit` sink as a typed
 * {@link GatewayEvent}. It exposes no per-event Observables — subscribers listen on the unified
 * stream (see GatewayEvents). Client→server invocations stay as typed methods.
 */
export class HarmonyHubClient {
  /**
   * @param connection the underlying SignalR connection.
   * @param emit the unified-stream sink — every coerced event is pushed here (GatewayEvents.emit).
   */
  constructor(
    private readonly connection: HubConnection,
    private readonly emit: (event: GatewayEvent) => void,
  ) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Server sends Snowflake IDs as JSON numbers — wrap in String() to preserve
    // type consistency with the string IDs stored via HTTP (BigInt interceptor).
    // Note: SignalR's JSON transport may still lose precision on very large IDs;
    // fixing that requires a custom hub protocol or backend string serialization.
    // SignalR delivers IDs as JSON numbers (no BigInt interceptor on WS).
    // Coerce all Snowflake ID fields to strings so they match the HTTP-derived
    // IDs stored in the message store.
    this.connection.on('MessageReceived', (msg: MessageResponse) =>
      this.emit({
        type: 'MessageReceived',
        message: {
          ...msg,
          messageId: String(msg.messageId),
          channelId: String(msg.channelId),
          // DM messages carry no guild — keep null rather than the string "null".
          guildId: msg.guildId != null ? String(msg.guildId) : null,
          userId: String(msg.userId),
          // sentAt/editedAt are longs serialized as strings by LongStringConverter
          sentAt: Number(msg.sentAt),
          editedAt: msg.editedAt != null ? Number(msg.editedAt) : null,
          replyToId: msg.replyToId != null ? String(msg.replyToId) : null,
          attachmentIds: (msg.attachmentIds ?? []).map(String),
          mentionIds: (msg.mentionIds ?? []).map(String),
          // Forward snapshot (attributed quote), when present: coerce the author id → string,
          // sentAt → number. Left null for ordinary messages.
          forward: msg.forward
            ? {
                authorId: String(msg.forward.authorId),
                authorName: msg.forward.authorName,
                content: msg.forward.content,
                sentAt: Number(msg.forward.sentAt),
              }
            : null,
        },
      }));

    // Backend broadcasts MessageEditedPayload as a single object argument
    this.connection.on('MessageEdited', (payload: {
      messageId: unknown; newContent: string; editedAt: unknown;
    }) =>
      this.emit({
        type: 'MessageEdited',
        edit: {
          messageId: String(payload.messageId),
          content: payload.newContent,
          editedAt: Number(payload.editedAt),
        },
      }));

    // Backend broadcasts MessageDeletedPayload as a single object argument (like MessageEdited),
    // so the id must be read off the payload — not treated as a scalar.
    this.connection.on('MessageDeleted', (payload: { messageId: unknown }) =>
      this.emit({ type: 'MessageDeleted', messageId: String(payload.messageId) }));

    this.connection.on('MessagePinned', (p: { messageId: unknown; channelId: unknown }) =>
      this.emit({
        type: 'MessagePinned',
        pin: { messageId: String(p.messageId), channelId: String(p.channelId) },
      }));

    this.connection.on('MessageUnpinned', (p: { messageId: unknown; channelId: unknown }) =>
      this.emit({
        type: 'MessageUnpinned',
        pin: { messageId: String(p.messageId), channelId: String(p.channelId) },
      }));

    // Reaction add/remove — a delta the store applies to the matching loaded message. The emoji
    // token is a plain string (Unicode char / custom:{id}); only the ids need coercion.
    this.connection.on('ReactionAdded', (p: {
      messageId: unknown; channelId: unknown; guildId: unknown; emoji: string; userId: unknown;
    }) =>
      this.emit({
        type: 'ReactionAdded',
        payload: {
          messageId: String(p.messageId),
          channelId: String(p.channelId),
          guildId: p.guildId != null ? String(p.guildId) : null,
          emoji: p.emoji,
          userId: String(p.userId),
        },
      }));

    this.connection.on('ReactionRemoved', (p: {
      messageId: unknown; channelId: unknown; guildId: unknown; emoji: string; userId: unknown;
    }) =>
      this.emit({
        type: 'ReactionRemoved',
        payload: {
          messageId: String(p.messageId),
          channelId: String(p.channelId),
          guildId: p.guildId != null ? String(p.guildId) : null,
          emoji: p.emoji,
          userId: String(p.userId),
        },
      }));

    this.connection.on('MessageFailed', (payload: MessageFailedPayload) =>
      this.emit({ type: 'MessageFailed', payload }));

    this.connection.on('UnreadCountUpdated', (payload: UnreadCountPayload) =>
      this.emit({ type: 'UnreadCountUpdated', payload }));

    this.connection.on('ChannelCreated', (channel: Channel) =>
      this.emit({ type: 'ChannelCreated', channel }));

    this.connection.on('ChannelUpdated', (channel: Channel) =>
      this.emit({ type: 'ChannelUpdated', channel }));

    this.connection.on('ChannelDeleted', (channelId: unknown) =>
      this.emit({ type: 'ChannelDeleted', channelId: String(channelId) }));

    // Backend sends (userId, channelId) positionally; the display name is resolved client-side
    // (nickname-aware) from the member/DM stores, so no username travels over the wire.
    this.connection.on('TypingStarted', (userId: unknown, channelId: unknown) =>
      this.emit({
        type: 'TypingStarted',
        payload: { userId: String(userId), channelId: String(channelId) },
      }));

    this.connection.on('TypingStopped', (userId: unknown, channelId: unknown) =>
      this.emit({
        type: 'TypingStopped',
        payload: { userId: String(userId), channelId: String(channelId) },
      }));

    this.connection.on('OnlineStatus', (payload: {
      userId: unknown; status: string; statusMessage: string | null;
    }) =>
      this.emit({
        type: 'OnlineStatus',
        payload: {
          userId: String(payload.userId),
          status: payload.status,
          statusMessage: payload.statusMessage ?? null,
        },
      }));

    this.connection.on('OfflineStatus', (payload: { userId: unknown }) =>
      this.emit({ type: 'OfflineStatus', payload: { userId: String(payload.userId) } }));

    this.connection.on('StatusChanged', (payload: {
      userId: unknown; status: string; statusMessage: string | null;
    }) =>
      this.emit({
        type: 'StatusChanged',
        payload: {
          userId: String(payload.userId),
          status: payload.status,
          statusMessage: payload.statusMessage ?? null,
        },
      }));

    this.connection.on('FriendRequest', (p: FriendUserPayload) =>
      this.emit({ type: 'FriendRequest', payload: this.coerceFriendUser(p) }));

    this.connection.on('FriendAccepted', (p: FriendUserPayload) =>
      this.emit({ type: 'FriendAccepted', payload: this.coerceFriendUser(p) }));

    this.connection.on('FriendRemoved', (p: { userId: unknown }) =>
      this.emit({ type: 'FriendRemoved', payload: { userId: String(p.userId) } }));

    this.connection.on('NotificationReceived', (p: {
      id: unknown; type: string; actorId: unknown;
      guildId: unknown; channelId: unknown; messageId: unknown; createdAt: unknown;
    }) =>
      this.emit({
        type: 'NotificationReceived',
        payload: {
          id: String(p.id),
          type: p.type,
          actorId: String(p.actorId),
          guildId: p.guildId != null ? String(p.guildId) : null,
          channelId: p.channelId != null ? String(p.channelId) : null,
          messageId: p.messageId != null ? String(p.messageId) : null,
          createdAt: Number(p.createdAt),
        },
      }));

    // Owner-only live unread-count push (mark-read/clear from another tab) so the bell badge stays
    // in sync without a refetch. Purely a UI hint; the authoritative count is the REST endpoint.
    this.connection.on('NotificationBadgeUpdate', (unreadCount: unknown) =>
      this.emit({ type: 'NotificationBadgeUpdate', unreadCount: Number(unreadCount) }));

    this.connection.on('MemberRemoved', (p: { guildId: unknown; userId: unknown }) =>
      this.emit({
        type: 'MemberRemoved',
        payload: { guildId: String(p.guildId), userId: String(p.userId) },
      }));

    this.connection.on('MemberJoined', (p: { guildId: unknown; member: Record<string, unknown> }) =>
      this.emit({
        type: 'MemberJoined',
        payload: { guildId: String(p.guildId), member: this.coerceMember(p.member) },
      }));

    this.connection.on('Kicked', (p: { guildId: unknown; reason: string | null; banned: boolean }) =>
      this.emit({
        type: 'Kicked',
        payload: { guildId: String(p.guildId), reason: p.reason ?? null, banned: p.banned },
      }));

    this.connection.on('MemberUpdated', (p: {
      guildId: unknown; userId: unknown; nickname: unknown; communicationDisabledUntil: unknown;
    }) =>
      this.emit({
        type: 'MemberUpdated',
        payload: {
          guildId: String(p.guildId),
          userId: String(p.userId),
          nickname: p.nickname != null ? String(p.nickname) : null,
          communicationDisabledUntil:
            p.communicationDisabledUntil != null ? Number(p.communicationDisabledUntil) : null,
        },
      }));

    // RoleCreated + RoleUpdated both fold into one RoleUpserted event — an upsert into the role list.
    this.connection.on('RoleCreated', (r: Role) =>
      this.emit({ type: 'RoleUpserted', role: this.coerceRole(r) }));
    this.connection.on('RoleUpdated', (r: Role) =>
      this.emit({ type: 'RoleUpserted', role: this.coerceRole(r) }));

    this.connection.on('RoleDeleted', (p: { guildId: unknown; roleId: unknown }) =>
      this.emit({
        type: 'RoleDeleted',
        payload: { guildId: String(p.guildId), roleId: String(p.roleId) },
      }));

    this.connection.on('MemberRoleUpdated', (p: {
      guildId: unknown; userId: unknown; roleIds: unknown[];
    }) =>
      this.emit({
        type: 'MemberRoleUpdated',
        payload: {
          guildId: String(p.guildId),
          userId: String(p.userId),
          roleIds: (p.roleIds ?? []).map(String),
        },
      }));

    this.connection.on('ChannelOverridesChanged', (p: { guildId: unknown; channelId: unknown }) =>
      this.emit({
        type: 'ChannelOverridesChanged',
        payload: { guildId: String(p.guildId), channelId: String(p.channelId) },
      }));

    this.connection.on('DmChannelUpdated', (p: { channelId: unknown }) =>
      this.emit({ type: 'DmChannelUpdated', channelId: String(p.channelId) }));

    this.connection.on(
      'ProfileUpdated',
      (p: { userId: unknown; avatarKey: unknown; username: unknown }) =>
        this.emit({
          type: 'ProfileUpdated',
          payload: {
            userId: String(p.userId),
            avatarKey: p.avatarKey != null ? String(p.avatarKey) : null,
            username: p.username != null ? String(p.username) : null,
          },
        }),
    );

    this.connection.on('GuildInvitesChanged', (p: { guildId: unknown }) =>
      this.emit({ type: 'GuildInvitesChanged', guildId: String(p.guildId) }));

    // Voice (LiveKit): join/leave/state-change of a channel's voice room. Fanned to the channel
    // group AND (for guild channels) the guild group, so a guild's channel list shows live rosters.
    this.connection.on('VoiceParticipantJoined', (p: Record<string, unknown>) =>
      this.emit({ type: 'VoiceParticipantJoined', payload: this.coerceVoiceParticipant(p) }));

    this.connection.on('VoiceStateUpdated', (p: Record<string, unknown>) =>
      this.emit({ type: 'VoiceStateUpdated', payload: this.coerceVoiceParticipant(p) }));

    this.connection.on('VoiceParticipantLeft', (p: {
      channelId: unknown; guildId: unknown; userId: unknown;
    }) =>
      this.emit({
        type: 'VoiceParticipantLeft',
        payload: {
          channelId: String(p.channelId),
          guildId: p.guildId != null ? String(p.guildId) : null,
          userId: String(p.userId),
        },
      }));

    // DM/group-DM call ringing (Slice 4). Sent per-user via Clients.Users(...) — the callee hasn't
    // joined any hub group when the ring arrives.
    this.connection.on('IncomingCall', (p: {
      channelId: unknown; callerId: unknown; startedAt: unknown;
    }) =>
      this.emit({
        type: 'IncomingCall',
        payload: {
          channelId: String(p.channelId),
          callerId: String(p.callerId),
          startedAt: Number(p.startedAt),
        },
      }));

    this.connection.on('CallCancelled', (p: { channelId: unknown }) =>
      this.emit({ type: 'CallCancelled', payload: { channelId: String(p.channelId) } }));

    this.connection.on('CallDeclined', (p: { channelId: unknown; userId: unknown }) =>
      this.emit({
        type: 'CallDeclined',
        payload: { channelId: String(p.channelId), userId: String(p.userId) },
      }));

    // Voice moderation (Slice B): a moderator moved you — targeted per-user; the VoiceStore
    // reconnects media to the destination channel.
    this.connection.on('VoiceForceMoved', (p: {
      fromChannelId: unknown; toChannelId: unknown; guildId: unknown;
    }) =>
      this.emit({
        type: 'VoiceForceMoved',
        payload: {
          fromChannelId: String(p.fromChannelId),
          toChannelId: String(p.toChannelId),
          guildId: p.guildId != null ? String(p.guildId) : null,
        },
      }));
  }

  /** Coerce a voice participant pushed over SignalR: Snowflake ids → strings, joinedAt → number. */
  private coerceVoiceParticipant(p: Record<string, unknown>): import('../models/voice.models').VoiceParticipant {
    return {
      channelId: String(p['channelId']),
      guildId: p['guildId'] != null ? String(p['guildId']) : null,
      userId: String(p['userId']),
      isMuted: Boolean(p['isMuted']),
      isDeafened: Boolean(p['isDeafened']),
      isVideoOn: Boolean(p['isVideoOn']),
      isStreaming: Boolean(p['isStreaming']),
      isServerMuted: Boolean(p['isServerMuted']),
      isServerDeafened: Boolean(p['isServerDeafened']),
      joinedAt: Number(p['joinedAt']),
    };
  }

  /** Coerce a member pushed over SignalR: Snowflake ids → strings, timestamps → numbers. */
  private coerceMember(m: Record<string, unknown>): GuildMember {
    return {
      userId: String(m['userId']),
      username: String(m['username']),
      nickname: m['nickname'] != null ? String(m['nickname']) : null,
      avatarKey: m['avatarKey'] != null ? String(m['avatarKey']) : null,
      isOwner: Boolean(m['isOwner']),
      joinedAt: Number(m['joinedAt']),
      communicationDisabledUntil:
        m['communicationDisabledUntil'] != null ? Number(m['communicationDisabledUntil']) : null,
      roleIds: ((m['roleIds'] as unknown[]) ?? []).map(String),
    };
  }

  /** Coerce a role pushed over SignalR: id/guildId as strings, permissionBits (long-as-string) to a number. */
  private coerceRole(r: Role): Role {
    return {
      ...r,
      id: String(r.id),
      guildId: String(r.guildId),
      permissionBits: Number(r.permissionBits),
    };
  }

  /** Coerce the Snowflake id to a string (SignalR may deliver it as a number). */
  private coerceFriendUser(p: FriendUserPayload): FriendUserPayload {
    return {
      id: String(p.id),
      username: p.username,
      avatarKey: p.avatarKey ?? null,
      bannerKey: p.bannerKey ?? null,
    };
  }

  get state(): HubConnectionState {
    return this.connection.state;
  }

  async start(): Promise<void> {
    await this.connection.start();
  }

  async stop(): Promise<void> {
    await this.connection.stop();
  }

  onReconnecting(callback: (error?: Error) => void): void {
    this.connection.onreconnecting(callback);
  }

  onReconnected(callback: (connectionId?: string) => void): void {
    this.connection.onreconnected(callback);
  }

  onClose(callback: (error?: Error) => void): void {
    this.connection.onclose(callback);
  }

  // Client → Server invocations.
  // The hub methods accept `long` — we pass Number(id) which may lose precision
  // for very large Snowflake IDs. Real-time group membership may be slightly off
  // until the backend is configured to accept string IDs or a custom SignalR JSON
  // protocol with BigInt support is added.

  // Backend is configured with AllowReadingFromString + LongStringConverter,
  // so hub methods receive string IDs and parse them as long accurately.

  /**
   * Primary send path: invokes the hub, which persists through the normal pipeline and returns the
   * new message's id (HubResult&lt;SendMessageResponse&gt;). The full message body arrives separately
   * on the MessageReceived broadcast (reconciled against the optimistic bubble by nonce). Snowflake
   * ids are passed as strings — the hub reads them via AllowReadingFromString. Throws on rejection.
   */
  async sendMessage(
    guildId: string | null,
    channelId: string,
    content: string,
    options: { attachmentIds?: string[]; replyToId?: string; nonce?: string } = {},
  ): Promise<string> {
    const result = await this.connection.invoke<{
      succeeded: boolean;
      data: { messageId: unknown } | null;
      errorMessage: string | null;
    }>(
      'SendMessage',
      channelId,
      guildId,
      content,
      options.attachmentIds ?? null,
      options.replyToId ?? null,
      options.nonce ?? null,
    );
    if (!result.succeeded || !result.data) {
      throw new Error(result.errorMessage ?? 'Send failed');
    }
    return String(result.data.messageId);
  }

  async joinGuild(guildId: string): Promise<void> {
    await this.connection.invoke('JoinGuild', guildId);
  }

  async leaveGuild(guildId: string): Promise<void> {
    await this.connection.invoke('LeaveGuild', guildId);
  }

  async joinChannel(channelId: string): Promise<void> {
    await this.connection.invoke('JoinChannel', channelId);
  }

  async leaveChannel(channelId: string): Promise<void> {
    await this.connection.invoke('LeaveChannel', channelId);
  }

  async startTyping(channelId: string): Promise<void> {
    await this.connection.invoke('StartTyping', channelId);
  }

  async stopTyping(channelId: string): Promise<void> {
    await this.connection.invoke('StopTyping', channelId);
  }

  async heartbeat(): Promise<void> {
    await this.connection.invoke('Heartbeat');
  }

  /** Reports client activity state — true after ~15 min idle, false on the next interaction. */
  async setIdle(idle: boolean): Promise<void> {
    await this.connection.invoke('SetIdle', idle);
  }

  // --- Voice signaling (LiveKit). Media flows client ↔ LiveKit Cloud; these only tell the server
  //     to publish/clear the ephemeral voice-state (roster + broadcasts). ---
  async joinVoice(channelId: string): Promise<void> {
    await this.connection.invoke('JoinVoice', channelId);
  }

  async leaveVoice(channelId: string): Promise<void> {
    await this.connection.invoke('LeaveVoice', channelId);
  }

  async updateVoiceState(
    isMuted: boolean,
    isDeafened: boolean,
    isVideoOn: boolean,
    isStreaming: boolean,
  ): Promise<void> {
    await this.connection.invoke('UpdateVoiceState', isMuted, isDeafened, isVideoOn, isStreaming);
  }

  // --- Voice moderation (Slice B). Gated server-side on MuteMembers/DeafenMembers/MoveMembers
  //     against the target's CURRENT room; null flags mean "leave that one unchanged". ---
  async moderateVoiceState(
    targetUserId: string,
    serverMute: boolean | null,
    serverDeafen: boolean | null,
  ): Promise<void> {
    await this.connection.invoke('ModerateVoiceState', targetUserId, serverMute, serverDeafen);
  }

  async moveVoiceParticipant(targetUserId: string, toChannelId: string): Promise<void> {
    await this.connection.invoke('MoveVoiceParticipant', targetUserId, toChannelId);
  }

  // --- DM/group-DM call ringing (Slice 4). The caller must already be in the channel's voice
  //     room (JoinVoice) before StartCall — the server enforces it. ---
  async startCall(channelId: string): Promise<void> {
    await this.connection.invoke('StartCall', channelId);
  }

  /** `missed: true` (hang-up/timeout while ringing) posts the missed-call system message. */
  async cancelCall(channelId: string, missed: boolean): Promise<void> {
    await this.connection.invoke('CancelCall', channelId, missed);
  }

  async declineCall(channelId: string): Promise<void> {
    await this.connection.invoke('DeclineCall', channelId);
  }
}
