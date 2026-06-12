import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';
import { Channel } from '../models/channel.models';
import { MessageFailedPayload, MessageResponse, UnreadCountPayload } from '../models/message.models';

export interface MessageEditedEvent {
  messageId: number;
  content: string;
  editedAt: string;
}

export interface TypingStartedEvent {
  userId: number;
  username: string;
  channelId: number;
}

export interface TypingStoppedEvent {
  userId: number;
  channelId: number;
}

export class HarmonyHubClient {
  private readonly _messageReceived = new Subject<MessageResponse>();
  private readonly _messageEdited = new Subject<MessageEditedEvent>();
  private readonly _messageDeleted = new Subject<number>();
  private readonly _messageFailed = new Subject<MessageFailedPayload>();
  private readonly _unreadCountUpdated = new Subject<UnreadCountPayload>();
  private readonly _channelCreated = new Subject<Channel>();
  private readonly _channelUpdated = new Subject<Channel>();
  private readonly _channelDeleted = new Subject<number>();
  private readonly _typingStarted = new Subject<TypingStartedEvent>();
  private readonly _typingStopped = new Subject<TypingStoppedEvent>();

  readonly messageReceived$: Observable<MessageResponse> = this._messageReceived.asObservable();
  readonly messageEdited$: Observable<MessageEditedEvent> = this._messageEdited.asObservable();
  readonly messageDeleted$: Observable<number> = this._messageDeleted.asObservable();
  readonly messageFailed$: Observable<MessageFailedPayload> = this._messageFailed.asObservable();
  readonly unreadCountUpdated$: Observable<UnreadCountPayload> = this._unreadCountUpdated.asObservable();
  readonly channelCreated$: Observable<Channel> = this._channelCreated.asObservable();
  readonly channelUpdated$: Observable<Channel> = this._channelUpdated.asObservable();
  readonly channelDeleted$: Observable<number> = this._channelDeleted.asObservable();
  readonly typingStarted$: Observable<TypingStartedEvent> = this._typingStarted.asObservable();
  readonly typingStopped$: Observable<TypingStoppedEvent> = this._typingStopped.asObservable();

  constructor(private readonly connection: HubConnection) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.connection.on('MessageReceived', (msg: MessageResponse) =>
      this._messageReceived.next(msg));

    this.connection.on('MessageEdited', (messageId: number, content: string, editedAt: string) =>
      this._messageEdited.next({ messageId, content, editedAt }));

    this.connection.on('MessageDeleted', (messageId: number) =>
      this._messageDeleted.next(messageId));

    this.connection.on('MessageFailed', (payload: MessageFailedPayload) =>
      this._messageFailed.next(payload));

    this.connection.on('UnreadCountUpdated', (payload: UnreadCountPayload) =>
      this._unreadCountUpdated.next(payload));

    this.connection.on('ChannelCreated', (channel: Channel) =>
      this._channelCreated.next(channel));

    this.connection.on('ChannelUpdated', (channel: Channel) =>
      this._channelUpdated.next(channel));

    this.connection.on('ChannelDeleted', (channelId: number) =>
      this._channelDeleted.next(channelId));

    this.connection.on('TypingStarted', (userId: number, username: string, channelId: number) =>
      this._typingStarted.next({ userId, username, channelId }));

    this.connection.on('TypingStopped', (userId: number, channelId: number) =>
      this._typingStopped.next({ userId, channelId }));
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

  // Client → Server invocations

  async joinGuild(guildId: number): Promise<void> {
    await this.connection.invoke('JoinGuild', guildId);
  }

  async leaveGuild(guildId: number): Promise<void> {
    await this.connection.invoke('LeaveGuild', guildId);
  }

  async joinChannel(channelId: number): Promise<void> {
    await this.connection.invoke('JoinChannel', channelId);
  }

  async leaveChannel(channelId: number): Promise<void> {
    await this.connection.invoke('LeaveChannel', channelId);
  }

  async startTyping(channelId: number): Promise<void> {
    await this.connection.invoke('StartTyping', channelId);
  }

  async stopTyping(channelId: number): Promise<void> {
    await this.connection.invoke('StopTyping', channelId);
  }

  async heartbeat(): Promise<void> {
    await this.connection.invoke('Heartbeat');
  }
}
