import { Subject } from 'rxjs';
import { HarmonyHubClient } from './harmony-hub.client';
import { HubConnectionState } from '@microsoft/signalr';

// Minimal mock that captures .on() registrations so we can trigger them in tests
function makeMockConnection() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    invoke: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onreconnected: vi.fn(),
    onclose: vi.fn(),
    state: HubConnectionState.Connected,
    // Helper to fire a registered event from tests
    emit(event: string, ...args: unknown[]) {
      handlers[event]?.(...args);
    },
  };
}

describe('HarmonyHubClient', () => {
  let conn: ReturnType<typeof makeMockConnection>;
  let client: HarmonyHubClient;

  beforeEach(() => {
    conn = makeMockConnection();
    client = new HarmonyHubClient(conn as never);
  });

  it('registers all expected server→client event handlers on construction', () => {
    const registeredEvents = conn.on.mock.calls.map(([event]) => event);
    expect(registeredEvents).toContain('MessageReceived');
    expect(registeredEvents).toContain('MessageFailed');
    expect(registeredEvents).toContain('UnreadCountUpdated');
    expect(registeredEvents).toContain('ChannelCreated');
    expect(registeredEvents).toContain('ChannelDeleted');
    expect(registeredEvents).toContain('TypingStarted');
  });

  it('dispatches MessageReceived to messageReceived$', () => {
    const received: unknown[] = [];
    client.messageReceived$.subscribe((m) => received.push(m));

    const payload = { messageId: 1, content: 'hello' };
    conn.emit('MessageReceived', payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(payload);
  });

  it('dispatches MessageFailed to messageFailed$', () => {
    const received: unknown[] = [];
    client.messageFailed$.subscribe((p) => received.push(p));

    const payload = { messageId: 42, channelId: 1, guildId: 1 };
    conn.emit('MessageFailed', payload);

    expect(received[0]).toBe(payload);
  });

  it('dispatches UnreadCountUpdated to unreadCountUpdated$', () => {
    const received: unknown[] = [];
    client.unreadCountUpdated$.subscribe((p) => received.push(p));

    const payload = { channelId: 5, guildId: 1, unreadCount: 3 };
    conn.emit('UnreadCountUpdated', payload);

    expect(received[0]).toBe(payload);
  });

  it('dispatches MessageEdited with individual args to messageEdited$', () => {
    const received: unknown[] = [];
    client.messageEdited$.subscribe((e) => received.push(e));

    conn.emit('MessageEdited', 99, 'new content', '2024-01-01T00:00:00Z');

    expect(received[0]).toEqual({
      messageId: 99,
      content: 'new content',
      editedAt: '2024-01-01T00:00:00Z',
    });
  });

  it('start() delegates to connection.start()', async () => {
    await client.start();
    expect(conn.start).toHaveBeenCalledOnce();
  });

  it('stop() delegates to connection.stop()', async () => {
    await client.stop();
    expect(conn.stop).toHaveBeenCalledOnce();
  });

  it('joinChannel() invokes JoinChannel with the channel id', async () => {
    await client.joinChannel(123);
    expect(conn.invoke).toHaveBeenCalledWith('JoinChannel', 123);
  });

  it('joinGuild() invokes JoinGuild with the guild id', async () => {
    await client.joinGuild(7);
    expect(conn.invoke).toHaveBeenCalledWith('JoinGuild', 7);
  });

  it('startTyping() invokes StartTyping', async () => {
    await client.startTyping(55);
    expect(conn.invoke).toHaveBeenCalledWith('StartTyping', 55);
  });

  it('exposes current connection state via .state', () => {
    expect(client.state).toBe(HubConnectionState.Connected);
  });
});
