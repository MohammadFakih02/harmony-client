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

  it('dispatches MessageReceived to messageReceived$ coercing Snowflake ids to strings', () => {
    const received: unknown[] = [];
    client.messageReceived$.subscribe((m) => received.push(m));

    // SignalR delivers ids as JSON numbers; the handler coerces them to strings.
    conn.emit('MessageReceived', {
      messageId: 1,
      channelId: 2,
      guildId: 3,
      userId: 4,
      content: 'hello',
      sentAt: 1704067200000,
      editedAt: null,
      replyToId: null,
      attachmentIds: [],
      mentionIds: [],
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      messageId: '1',
      channelId: '2',
      guildId: '3',
      userId: '4',
      content: 'hello',
      sentAt: 1704067200000,
    });
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

  it('dispatches MessageEdited as a single payload object to messageEdited$', () => {
    const received: unknown[] = [];
    client.messageEdited$.subscribe((e) => received.push(e));

    // Backend broadcasts MessageEditedPayload { messageId, newContent, editedAt }
    // as one object; editedAt is a Unix-ms long. The handler coerces the id to a
    // string and editedAt to a number.
    conn.emit('MessageEdited', { messageId: 99, newContent: 'new content', editedAt: 1704067200000 });

    expect(received[0]).toEqual({
      messageId: '99',
      content: 'new content',
      editedAt: 1704067200000,
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
    await client.joinChannel('123');
    expect(conn.invoke).toHaveBeenCalledWith('JoinChannel', '123');
  });

  it('joinGuild() invokes JoinGuild with the guild id', async () => {
    await client.joinGuild('7');
    expect(conn.invoke).toHaveBeenCalledWith('JoinGuild', '7');
  });

  it('startTyping() invokes StartTyping', async () => {
    await client.startTyping('55');
    expect(conn.invoke).toHaveBeenCalledWith('StartTyping', '55');
  });

  it('exposes current connection state via .state', () => {
    expect(client.state).toBe(HubConnectionState.Connected);
  });

  it('registers presence event handlers', () => {
    const registeredEvents = conn.on.mock.calls.map(([event]) => event);
    expect(registeredEvents).toContain('OnlineStatus');
    expect(registeredEvents).toContain('OfflineStatus');
    expect(registeredEvents).toContain('StatusChanged');
  });

  it('dispatches OnlineStatus to onlineStatus$ coercing userId to a string', () => {
    const received: unknown[] = [];
    client.onlineStatus$.subscribe((p) => received.push(p));

    conn.emit('OnlineStatus', { userId: 7, status: 'online' });

    expect(received[0]).toEqual({ userId: '7', status: 'online' });
  });

  it('dispatches OfflineStatus to offlineStatus$', () => {
    const received: unknown[] = [];
    client.offlineStatus$.subscribe((p) => received.push(p));

    conn.emit('OfflineStatus', { userId: 7 });

    expect(received[0]).toEqual({ userId: '7' });
  });

  it('dispatches StatusChanged to statusChanged$', () => {
    const received: unknown[] = [];
    client.statusChanged$.subscribe((p) => received.push(p));

    conn.emit('StatusChanged', { userId: 7, status: 'dnd', statusMessage: null });

    expect(received[0]).toEqual({ userId: '7', status: 'dnd', statusMessage: null });
  });

  it('setIdle() invokes SetIdle with the boolean flag', async () => {
    await client.setIdle(true);
    expect(conn.invoke).toHaveBeenCalledWith('SetIdle', true);
  });

  it('heartbeat() invokes Heartbeat', async () => {
    await client.heartbeat();
    expect(conn.invoke).toHaveBeenCalledWith('Heartbeat');
  });
});
