import { Injectable, inject, signal } from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { environment } from '../../../environments/environment';
import { HarmonyHubClient } from '../hub/harmony-hub.client';
import { GatewayEvents } from '../hub/gateway-events';
import { AuthService } from './auth.service';

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'disconnected';

/** How often the client pings the server to keep its presence TTL (60s) alive. */
const HEARTBEAT_INTERVAL_MS = 45_000;

/** Background re-connect cadence after the SignalR auto-reconnect gives up. */
const RECONNECT_RETRY_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class SignalRService {
  private readonly auth = inject(AuthService);
  private readonly gateway = inject(GatewayEvents);
  private _client: HarmonyHubClient | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private starting: Promise<void> | null = null;
  private stopped = false;

  readonly connectionState = signal<ConnectionState>('idle');

  // Desired group membership — the single source of truth for what we *should* be joined to.
  // Joins issued while disconnected are recorded here and flushed to the server on every (re)connect,
  // so a route that activates before the socket is live can never leave us silently un-joined.
  private readonly desiredGuildIds = new Set<string>();
  private desiredChannelId: string | null = null;

  get client(): HarmonyHubClient | null {
    return this._client;
  }

  get isConnected(): boolean {
    return this._client?.state === HubConnectionState.Connected;
  }

  /**
   * Builds the hub client (and its event Subjects) WITHOUT starting the socket. Safe to call
   * repeatedly — returns the singleton. Callers subscribe to its event streams immediately, before
   * (or even without) a live connection: the Subjects persist across reconnects, so a failed/slow
   * initial connect can never leave the session deaf (the old `if (!client) return` did exactly that).
   */
  getOrCreateClient(): HarmonyHubClient {
    if (this._client) return this._client;

    const connection = new HubConnectionBuilder()
      .withUrl(`${environment.signalRUrl}/chat`, {
        accessTokenFactory: () => this.auth.getAccessToken() ?? '',
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    // Every coerced server→client event flows into the shared gateway stream (a root singleton that
    // outlives this connection), which stores subscribe to. The client itself exposes no Observables.
    this._client = new HarmonyHubClient(connection, (e) => this.gateway.emit(e));

    this._client.onReconnecting(() => this.connectionState.set('reconnecting'));
    this._client.onReconnected(() => this.onConnected());
    // onClose fires when auto-reconnect gives up (all retry delays exhausted). Keep trying in the
    // background so the app self-heals without a manual page refresh.
    this._client.onClose(() => {
      this.connectionState.set('disconnected');
      this.stopHeartbeat();
      if (!this.stopped) this.scheduleReconnect();
    });

    return this._client;
  }

  /**
   * Ensures the socket is connecting/connected. A single failed attempt is NOT fatal: it schedules a
   * background retry (e.g. the access token landing a beat after page load), so the connection
   * self-heals. Resolves once connected; rejects only the immediate attempt (callers may ignore it —
   * event subscriptions and the retry loop are independent of this promise).
   */
  async connect(): Promise<HarmonyHubClient> {
    this.stopped = false;
    const client = this.getOrCreateClient();
    if (client.state === HubConnectionState.Connected) return client;
    await this.startOnce(client);
    return client;
  }

  private async startOnce(client: HarmonyHubClient): Promise<void> {
    // Collapse concurrent start attempts (initial connect + a fired reconnect timer).
    if (this.starting) return this.starting;
    if (client.state === HubConnectionState.Connected) return;

    this.starting = (async () => {
      try {
        await client.start();
        this.onConnected();
      } catch (err) {
        this.connectionState.set('disconnected');
        if (!this.stopped) this.scheduleReconnect();
        throw err;
      } finally {
        this.starting = null;
      }
    })();

    return this.starting;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const client = this._client;
      if (!client || client.state === HubConnectionState.Connected || this.stopped) return;
      // Restarting a closed HubConnection re-runs accessTokenFactory, so a token that wasn't ready
      // at first load is picked up here. Keep retrying on failure.
      this.startOnce(client).catch(() => this.scheduleReconnect());
    }, RECONNECT_RETRY_MS);
  }

  /** Runs on every successful (re)connect: refresh state, restart heartbeat, re-flush group joins. */
  private onConnected(): void {
    this.connectionState.set('connected');
    this.startHeartbeat();
    void this.flushGroups();
  }

  /** Re-issues every desired group join — applied on each (re)connect so nothing recorded offline is lost. */
  private async flushGroups(): Promise<void> {
    const client = this._client;
    if (!client || client.state !== HubConnectionState.Connected) return;
    for (const guildId of this.desiredGuildIds) {
      await client.joinGuild(guildId).catch(() => {});
    }
    if (this.desiredChannelId) {
      await client.joinChannel(this.desiredChannelId).catch(() => {});
    }
  }

  // --- Connection-state-aware group membership (use these from components, not client.* directly) ---

  /** Record intent to be in a guild's group and join now if connected. Idempotent + reconnect-safe. */
  async joinGuild(guildId: string): Promise<void> {
    this.desiredGuildIds.add(guildId);
    if (this.isConnected) await this._client!.joinGuild(guildId).catch(() => {});
  }

  async leaveGuild(guildId: string): Promise<void> {
    this.desiredGuildIds.delete(guildId);
    if (this.isConnected) await this._client!.leaveGuild(guildId).catch(() => {});
  }

  /** Record the single active channel and join now if connected; re-joined automatically on reconnect. */
  async joinChannel(channelId: string): Promise<void> {
    this.desiredChannelId = channelId;
    if (this.isConnected) await this._client!.joinChannel(channelId).catch(() => {});
  }

  async leaveChannel(channelId: string): Promise<void> {
    if (this.desiredChannelId === channelId) this.desiredChannelId = null;
    if (this.isConnected) await this._client!.leaveChannel(channelId).catch(() => {});
  }

  /** Fire-and-forget typing signals — ephemeral, so simply skipped when the socket isn't live. */
  startTyping(channelId: string): void {
    if (this.isConnected) void this._client!.startTyping(channelId).catch(() => {});
  }

  stopTyping(channelId: string): void {
    if (this.isConnected) void this._client!.stopTyping(channelId).catch(() => {});
  }

  // --- Voice signaling (LiveKit). The store publishes voice-state to the server; the media path is
  //     handled separately by VoiceService. join/leave await so the store can order its LiveKit ops. ---
  async joinVoice(channelId: string): Promise<void> {
    if (this.isConnected) await this._client!.joinVoice(channelId).catch(() => {});
  }

  async leaveVoice(channelId: string): Promise<void> {
    if (this.isConnected) await this._client!.leaveVoice(channelId).catch(() => {});
  }

  /** Fire-and-forget mute/deafen/video state — ephemeral, skipped when the socket isn't live. */
  updateVoiceState(
    isMuted: boolean,
    isDeafened: boolean,
    isVideoOn: boolean,
    isStreaming: boolean,
  ): void {
    if (this.isConnected)
      void this._client!.updateVoiceState(isMuted, isDeafened, isVideoOn, isStreaming).catch(() => {});
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.desiredGuildIds.clear();
    this.desiredChannelId = null;
    if (this._client) {
      await this._client.stop();
      this._client = null;
      this.connectionState.set('idle');
    }
  }

  // Without a periodic heartbeat the server's 60s presence TTL expires and the user
  // appears offline to everyone while still connected. The 45s cadence keeps it alive.
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this._client?.heartbeat().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
