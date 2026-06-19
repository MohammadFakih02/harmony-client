import { Injectable, inject, signal } from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { environment } from '../../../environments/environment';
import { HarmonyHubClient } from '../hub/harmony-hub.client';
import { AuthService } from './auth.service';

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'disconnected';

/** How often the client pings the server to keep its presence TTL (60s) alive. */
const HEARTBEAT_INTERVAL_MS = 45_000;

@Injectable({ providedIn: 'root' })
export class SignalRService {
  private readonly auth = inject(AuthService);
  private _client: HarmonyHubClient | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  readonly connectionState = signal<ConnectionState>('idle');

  get client(): HarmonyHubClient | null {
    return this._client;
  }

  get isConnected(): boolean {
    return this._client?.state === HubConnectionState.Connected;
  }

  async connect(): Promise<HarmonyHubClient> {
    if (this._client && this._client.state === HubConnectionState.Connected) {
      return this._client;
    }

    const connection = new HubConnectionBuilder()
      .withUrl(`${environment.signalRUrl}/chat`, {
        accessTokenFactory: () => this.auth.getAccessToken() ?? '',
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    this._client = new HarmonyHubClient(connection);

    this._client.onReconnecting(() => {
      this.connectionState.set('reconnecting');
    });

    this._client.onReconnected(() => {
      this.connectionState.set('connected');
    });

    // onClose fires when auto-reconnect gives up (all retry delays exhausted)
    this._client.onClose(() => {
      this.connectionState.set('disconnected');
    });

    await this._client.start();
    this.connectionState.set('connected');
    this.startHeartbeat();
    return this._client;
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
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
