import { HarmonyHubClient } from './harmony-hub.client';
import { GatewayEvent } from './gateway-events';
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
  let events: GatewayEvent[];
  let client: HarmonyHubClient;

  beforeEach(() => {
    conn = makeMockConnection();
    events = [];
    // Every coerced server→client event is pushed into this sink (GatewayEvents.emit in production).
    client = new HarmonyHubClient(conn as never, (e) => events.push(e));
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

  it('emits a MessageReceived gateway event coercing Snowflake ids to strings', () => {
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

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'MessageReceived',
      message: {
        messageId: '1',
        channelId: '2',
        guildId: '3',
        userId: '4',
        content: 'hello',
        sentAt: 1704067200000,
      },
    });
  });

  it('emits a MessageFailed gateway event carrying the payload', () => {
    const payload = { messageId: 42, channelId: 1, guildId: 1 };
    conn.emit('MessageFailed', payload);

    expect(events[0]).toEqual({ type: 'MessageFailed', payload });
  });

  it('emits an UnreadCountUpdated gateway event carrying the payload', () => {
    const payload = { channelId: 5, guildId: 1, unreadCount: 3 };
    conn.emit('UnreadCountUpdated', payload);

    expect(events[0]).toEqual({ type: 'UnreadCountUpdated', payload });
  });

  it('emits MessageEdited from the single payload object, coercing id + editedAt', () => {
    // Backend broadcasts MessageEditedPayload { messageId, newContent, editedAt }
    // as one object; editedAt is a Unix-ms long. The handler coerces the id to a
    // string and editedAt to a number.
    conn.emit('MessageEdited', { messageId: 99, newContent: 'new content', editedAt: 1704067200000 });

    expect(events[0]).toEqual({
      type: 'MessageEdited',
      edit: { messageId: '99', content: 'new content', editedAt: 1704067200000 },
    });
  });

  it('folds RoleCreated and RoleUpdated into RoleUpserted, coercing ids + permissionBits', () => {
    conn.emit('RoleCreated', { id: 10, guildId: 20, name: 'Mods', permissionBits: '8', position: 1 });
    conn.emit('RoleUpdated', { id: 10, guildId: 20, name: 'Mods', permissionBits: '8', position: 2 });

    expect(events.map((e) => e.type)).toEqual(['RoleUpserted', 'RoleUpserted']);
    expect(events[0]).toMatchObject({
      type: 'RoleUpserted',
      role: { id: '10', guildId: '20', permissionBits: 8 },
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

  it('emits OnlineStatus coercing userId to a string', () => {
    conn.emit('OnlineStatus', { userId: 7, status: 'online', statusMessage: 'brb' });
    expect(events[0]).toEqual({
      type: 'OnlineStatus',
      payload: { userId: '7', status: 'online', statusMessage: 'brb' },
    });
  });

  it('emits OfflineStatus coercing userId to a string', () => {
    conn.emit('OfflineStatus', { userId: 7 });
    expect(events[0]).toEqual({ type: 'OfflineStatus', payload: { userId: '7' } });
  });

  it('emits StatusChanged carrying the status message', () => {
    conn.emit('StatusChanged', { userId: 7, status: 'dnd', statusMessage: null });
    expect(events[0]).toEqual({
      type: 'StatusChanged',
      payload: { userId: '7', status: 'dnd', statusMessage: null },
    });
  });

  it('emits ProfileUpdated coercing userId to a string, keeping a null avatar', () => {
    conn.emit('ProfileUpdated', { userId: 7, avatarKey: 'avatars/7/9' });
    expect(events[0]).toEqual({
      type: 'ProfileUpdated',
      payload: { userId: '7', avatarKey: 'avatars/7/9' },
    });

    conn.emit('ProfileUpdated', { userId: 7, avatarKey: null });
    expect(events[1]).toEqual({
      type: 'ProfileUpdated',
      payload: { userId: '7', avatarKey: null },
    });
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
