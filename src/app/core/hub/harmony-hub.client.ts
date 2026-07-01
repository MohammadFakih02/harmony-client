import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';
import { Channel } from '../models/channel.models';
import { MessageFailedPayload, MessageResponse, UnreadCountPayload } from '../models/message.models';
import {
  OfflineStatusPayload,
  OnlineStatusPayload,
  StatusChangedPayload,
} from '../models/presence.models';
import { FriendRemovedPayload, FriendUserPayload } from '../models/friend.models';
import { NotificationPayload } from '../models/notification.models';
import {
  KickedPayload,
  MemberRemovedPayload,
  MemberUpdatedPayload,
} from '../models/member.models';
import { MemberRoleUpdatedPayload, Role, RoleDeletedPayload } from '../models/role.models';

export interface MessageEditedEvent {
  messageId: string;
  content: string;
  editedAt: number;
}

export interface TypingStartedEvent {
  userId: string;
  username: string;
  channelId: string;
}

export interface TypingStoppedEvent {
  userId: string;
  channelId: string;
}

export class HarmonyHubClient {
  private readonly _messageReceived = new Subject<MessageResponse>();
  private readonly _messageEdited = new Subject<MessageEditedEvent>();
  private readonly _messageDeleted = new Subject<string>();
  private readonly _messageFailed = new Subject<MessageFailedPayload>();
  private readonly _unreadCountUpdated = new Subject<UnreadCountPayload>();
  private readonly _channelCreated = new Subject<Channel>();
  private readonly _channelUpdated = new Subject<Channel>();
  private readonly _channelDeleted = new Subject<string>();
  private readonly _typingStarted = new Subject<TypingStartedEvent>();
  private readonly _typingStopped = new Subject<TypingStoppedEvent>();
  private readonly _onlineStatus = new Subject<OnlineStatusPayload>();
  private readonly _offlineStatus = new Subject<OfflineStatusPayload>();
  private readonly _statusChanged = new Subject<StatusChangedPayload>();
  private readonly _friendRequest = new Subject<FriendUserPayload>();
  private readonly _friendAccepted = new Subject<FriendUserPayload>();
  private readonly _friendRemoved = new Subject<FriendRemovedPayload>();
  private readonly _notificationReceived = new Subject<NotificationPayload>();
  private readonly _memberRemoved = new Subject<MemberRemovedPayload>();
  private readonly _kicked = new Subject<KickedPayload>();
  private readonly _memberUpdated = new Subject<MemberUpdatedPayload>();
  private readonly _roleUpserted = new Subject<Role>();
  private readonly _roleDeleted = new Subject<RoleDeletedPayload>();
  private readonly _memberRoleUpdated = new Subject<MemberRoleUpdatedPayload>();
  private readonly _dmChannelUpdated = new Subject<string>();

  readonly messageReceived$: Observable<MessageResponse> = this._messageReceived.asObservable();
  readonly messageEdited$: Observable<MessageEditedEvent> = this._messageEdited.asObservable();
  readonly messageDeleted$: Observable<string> = this._messageDeleted.asObservable();
  readonly messageFailed$: Observable<MessageFailedPayload> = this._messageFailed.asObservable();
  readonly unreadCountUpdated$: Observable<UnreadCountPayload> = this._unreadCountUpdated.asObservable();
  readonly channelCreated$: Observable<Channel> = this._channelCreated.asObservable();
  readonly channelUpdated$: Observable<Channel> = this._channelUpdated.asObservable();
  readonly channelDeleted$: Observable<string> = this._channelDeleted.asObservable();
  readonly typingStarted$: Observable<TypingStartedEvent> = this._typingStarted.asObservable();
  readonly typingStopped$: Observable<TypingStoppedEvent> = this._typingStopped.asObservable();
  readonly onlineStatus$: Observable<OnlineStatusPayload> = this._onlineStatus.asObservable();
  readonly offlineStatus$: Observable<OfflineStatusPayload> = this._offlineStatus.asObservable();
  readonly statusChanged$: Observable<StatusChangedPayload> = this._statusChanged.asObservable();
  readonly friendRequest$: Observable<FriendUserPayload> = this._friendRequest.asObservable();
  readonly friendAccepted$: Observable<FriendUserPayload> = this._friendAccepted.asObservable();
  readonly friendRemoved$: Observable<FriendRemovedPayload> = this._friendRemoved.asObservable();
  readonly notificationReceived$: Observable<NotificationPayload> =
    this._notificationReceived.asObservable();
  readonly memberRemoved$: Observable<MemberRemovedPayload> = this._memberRemoved.asObservable();
  readonly kicked$: Observable<KickedPayload> = this._kicked.asObservable();
  readonly memberUpdated$: Observable<MemberUpdatedPayload> = this._memberUpdated.asObservable();
  // RoleCreated + RoleUpdated share one stream — both are upserts into the role list.
  readonly roleUpserted$: Observable<Role> = this._roleUpserted.asObservable();
  readonly roleDeleted$: Observable<RoleDeletedPayload> = this._roleDeleted.asObservable();
  readonly memberRoleUpdated$: Observable<MemberRoleUpdatedPayload> =
    this._memberRoleUpdated.asObservable();
  // A DM/group channel's membership changed (group created, participant added, someone left)
  // → emits the channel id so the listener resyncs the DM list.
  readonly dmChannelUpdated$: Observable<string> = this._dmChannelUpdated.asObservable();

  constructor(private readonly connection: HubConnection) {
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
      this._messageReceived.next({
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
      }));

    // Backend broadcasts MessageEditedPayload as a single object argument
    this.connection.on('MessageEdited', (payload: {
      messageId: unknown; newContent: string; editedAt: unknown;
    }) =>
      this._messageEdited.next({
        messageId: String(payload.messageId),
        content: payload.newContent,
        editedAt: Number(payload.editedAt),
      }));

    // Backend broadcasts MessageDeletedPayload as a single object argument (like MessageEdited),
    // so the id must be read off the payload — not treated as a scalar.
    this.connection.on('MessageDeleted', (payload: { messageId: unknown }) =>
      this._messageDeleted.next(String(payload.messageId)));

    this.connection.on('MessageFailed', (payload: MessageFailedPayload) =>
      this._messageFailed.next(payload));

    this.connection.on('UnreadCountUpdated', (payload: UnreadCountPayload) =>
      this._unreadCountUpdated.next(payload));

    this.connection.on('ChannelCreated', (channel: Channel) =>
      this._channelCreated.next(channel));

    this.connection.on('ChannelUpdated', (channel: Channel) =>
      this._channelUpdated.next(channel));

    this.connection.on('ChannelDeleted', (channelId: unknown) =>
      this._channelDeleted.next(String(channelId)));

    this.connection.on('TypingStarted', (userId: unknown, username: string, channelId: unknown) =>
      this._typingStarted.next({ userId: String(userId), username, channelId: String(channelId) }));

    this.connection.on('TypingStopped', (userId: unknown, channelId: unknown) =>
      this._typingStopped.next({ userId: String(userId), channelId: String(channelId) }));

    this.connection.on('OnlineStatus', (payload: { userId: unknown; status: string }) =>
      this._onlineStatus.next({ userId: String(payload.userId), status: payload.status }));

    this.connection.on('OfflineStatus', (payload: { userId: unknown }) =>
      this._offlineStatus.next({ userId: String(payload.userId) }));

    this.connection.on('StatusChanged', (payload: {
      userId: unknown; status: string; statusMessage: string | null;
    }) =>
      this._statusChanged.next({
        userId: String(payload.userId),
        status: payload.status,
        statusMessage: payload.statusMessage ?? null,
      }));

    this.connection.on('FriendRequest', (p: FriendUserPayload) =>
      this._friendRequest.next(this.coerceFriendUser(p)));

    this.connection.on('FriendAccepted', (p: FriendUserPayload) =>
      this._friendAccepted.next(this.coerceFriendUser(p)));

    this.connection.on('FriendRemoved', (p: { userId: unknown }) =>
      this._friendRemoved.next({ userId: String(p.userId) }));

    this.connection.on('NotificationReceived', (p: {
      id: unknown; type: string; actorId: unknown;
      guildId: unknown; channelId: unknown; messageId: unknown; createdAt: unknown;
    }) =>
      this._notificationReceived.next({
        id: String(p.id),
        type: p.type,
        actorId: String(p.actorId),
        guildId: p.guildId != null ? String(p.guildId) : null,
        channelId: p.channelId != null ? String(p.channelId) : null,
        messageId: p.messageId != null ? String(p.messageId) : null,
        createdAt: Number(p.createdAt),
      }));

    this.connection.on('MemberRemoved', (p: { guildId: unknown; userId: unknown }) =>
      this._memberRemoved.next({ guildId: String(p.guildId), userId: String(p.userId) }));

    this.connection.on('Kicked', (p: { guildId: unknown; reason: string | null; banned: boolean }) =>
      this._kicked.next({ guildId: String(p.guildId), reason: p.reason ?? null, banned: p.banned }));

    this.connection.on('MemberUpdated', (p: {
      guildId: unknown; userId: unknown; nickname: unknown; communicationDisabledUntil: unknown;
    }) =>
      this._memberUpdated.next({
        guildId: String(p.guildId),
        userId: String(p.userId),
        nickname: p.nickname != null ? String(p.nickname) : null,
        communicationDisabledUntil:
          p.communicationDisabledUntil != null ? Number(p.communicationDisabledUntil) : null,
      }));

    this.connection.on('RoleCreated', (r: Role) => this._roleUpserted.next(this.coerceRole(r)));
    this.connection.on('RoleUpdated', (r: Role) => this._roleUpserted.next(this.coerceRole(r)));

    this.connection.on('RoleDeleted', (p: { guildId: unknown; roleId: unknown }) =>
      this._roleDeleted.next({ guildId: String(p.guildId), roleId: String(p.roleId) }));

    this.connection.on('MemberRoleUpdated', (p: {
      guildId: unknown; userId: unknown; roleIds: unknown[];
    }) =>
      this._memberRoleUpdated.next({
        guildId: String(p.guildId),
        userId: String(p.userId),
        roleIds: (p.roleIds ?? []).map(String),
      }));

    this.connection.on('DmChannelUpdated', (p: { channelId: unknown }) =>
      this._dmChannelUpdated.next(String(p.channelId)));
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
}
