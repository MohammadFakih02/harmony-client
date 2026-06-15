import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';
import { Channel } from '../models/channel.models';
import { MessageFailedPayload, MessageResponse, UnreadCountPayload } from '../models/message.models';

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
        guildId: String(msg.guildId),
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

    this.connection.on('MessageDeleted', (messageId: unknown) =>
      this._messageDeleted.next(String(messageId)));

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
}
