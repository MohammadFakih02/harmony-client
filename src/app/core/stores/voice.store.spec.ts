import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VoiceStore } from './voice.store';
import { VoiceService } from '../services/voice.service';
import { SignalRService } from '../services/signalr.service';
import { AuthService } from '../services/auth.service';
import { ChannelStore } from './channel.store';
import { GatewayEvents } from '../hub/gateway-events';
import { VoiceParticipant } from '../models/voice.models';

function participant(over: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    channelId: 'c1',
    guildId: 'g1',
    userId: 'u1',
    isMuted: false,
    isDeafened: false,
    isVideoOn: false,
    isStreaming: false,
    isServerMuted: false,
    isServerDeafened: false,
    joinedAt: 1,
    ...over,
  };
}

describe('VoiceStore', () => {
  let store: InstanceType<typeof VoiceStore>;
  let voice: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getParticipants: ReturnType<typeof vi.fn>;
    setMicMuted: ReturnType<typeof vi.fn>;
    setDeafened: ReturnType<typeof vi.fn>;
    setCameraEnabled: ReturnType<typeof vi.fn>;
    setScreenShareEnabled: ReturnType<typeof vi.fn>;
    syncWatchedStreams: ReturnType<typeof vi.fn>;
    speakingUserIds: ReturnType<typeof signal<ReadonlySet<string>>>;
    localScreenShareOn: ReturnType<typeof signal<boolean>>;
  };
  let signalR: {
    joinVoice: ReturnType<typeof vi.fn>;
    leaveVoice: ReturnType<typeof vi.fn>;
    updateVoiceState: ReturnType<typeof vi.fn>;
    moderateVoiceState: ReturnType<typeof vi.fn>;
    moveVoiceParticipant: ReturnType<typeof vi.fn>;
  };
  // The store resolves the joined channel's bitrate from here (guild voice channels only).
  let channelsByGuild: ReturnType<typeof signal<Record<string, { id: string; bitrate: number | null }[]>>>;

  beforeEach(() => {
    voice = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getParticipants: vi.fn().mockResolvedValue([]),
      setMicMuted: vi.fn(),
      setDeafened: vi.fn(),
      // The real service resolves to the *achieved* state (device error / picker-cancel keeps the old one).
      setCameraEnabled: vi.fn(async (on: boolean) => on),
      setScreenShareEnabled: vi.fn(async (on: boolean) => on),
      syncWatchedStreams: vi.fn(),
      speakingUserIds: signal<ReadonlySet<string>>(new Set()),
      localScreenShareOn: signal(false),
    };
    signalR = {
      joinVoice: vi.fn().mockResolvedValue(undefined),
      leaveVoice: vi.fn().mockResolvedValue(undefined),
      updateVoiceState: vi.fn(),
      moderateVoiceState: vi.fn().mockResolvedValue(undefined),
      moveVoiceParticipant: vi.fn().mockResolvedValue(undefined),
    };
    channelsByGuild = signal<Record<string, { id: string; bitrate: number | null }[]>>({});

    TestBed.configureTestingModule({
      providers: [
        VoiceStore,
        { provide: VoiceService, useValue: voice },
        { provide: SignalRService, useValue: signalR },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
        { provide: ChannelStore, useValue: { channelsByGuild } },
      ],
    });
    store = TestBed.inject(VoiceStore);
  });

  it('participantsOf() defaults to an empty roster', () => {
    expect(store.participantsOf('c1')).toEqual([]);
    expect(store.inVoice()).toBe(false);
  });

  it('applyJoined upserts and applyLeft removes', () => {
    store.applyJoined(participant({ userId: 'u1' }));
    store.applyJoined(participant({ userId: 'u2' }));
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['u1', 'u2']);

    store.applyLeft('c1', 'u1');
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['u2']);
  });

  it('applyStateUpdated replaces the existing entry (no duplicate)', () => {
    store.applyJoined(participant({ userId: 'u1', isMuted: false }));
    store.applyStateUpdated(participant({ userId: 'u1', isMuted: true }));

    const roster = store.participantsOf('c1');
    expect(roster).toHaveLength(1);
    expect(roster[0].isMuted).toBe(true);
  });

  it('join() connects media, signals the server, and seeds the roster', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);

    await store.join('c1');

    expect(voice.connect).toHaveBeenCalledWith('c1', expect.any(Function), null);
    expect(signalR.joinVoice).toHaveBeenCalledWith('c1');
    expect(store.activeChannelId()).toBe('c1');
    expect(store.inVoice()).toBe(true);
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['me']);
  });

  it('join() goes active immediately without waiting on the getParticipants round trip', async () => {
    // getParticipants never resolves — join must still connect us with an optimistic self entry.
    voice.getParticipants.mockReturnValue(new Promise<never>(() => {}));

    await store.join('c1');

    expect(store.activeChannelId()).toBe('c1');
    expect(store.connecting()).toBe(false);
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['me']);
    expect(signalR.joinVoice).toHaveBeenCalledWith('c1');
  });

  it('join() is a no-op when already in that channel', async () => {
    await store.join('c1');
    voice.connect.mockClear();
    await store.join('c1');
    expect(voice.connect).not.toHaveBeenCalled();
  });

  it('join() rolls back on a media failure', async () => {
    voice.connect.mockRejectedValue(new Error('mic denied'));
    await store.join('c1');

    expect(store.activeChannelId()).toBeNull();
    expect(store.connecting()).toBe(false);
    expect(voice.disconnect).toHaveBeenCalled();
  });

  it('cancelJoin() while connecting aborts the in-flight join', async () => {
    let resolveConnect!: () => void;
    voice.connect.mockReturnValue(new Promise<void>((r) => (resolveConnect = r)));

    const joinPromise = store.join('c1');
    expect(store.connecting()).toBe(true);
    expect(store.connectingChannelId()).toBe('c1');

    await store.cancelJoin();
    expect(store.connecting()).toBe(false);
    expect(store.connectingChannelId()).toBeNull();
    expect(voice.disconnect).toHaveBeenCalled();

    // The media connect resolves late — join must bail without going active or signaling a join.
    resolveConnect();
    await joinPromise;
    expect(store.activeChannelId()).toBeNull();
    expect(store.inVoice()).toBe(false);
    expect(signalR.joinVoice).not.toHaveBeenCalled();
  });

  it('leave() during connecting routes to cancelJoin', async () => {
    let resolveConnect!: () => void;
    voice.connect.mockReturnValue(new Promise<void>((r) => (resolveConnect = r)));

    const joinPromise = store.join('c1');
    expect(store.connecting()).toBe(true);

    await store.leave();
    expect(store.connecting()).toBe(false);
    expect(store.connectingChannelId()).toBeNull();

    resolveConnect();
    await joinPromise;
    expect(signalR.joinVoice).not.toHaveBeenCalled();
  });

  it('leave() tears down media + signaling and clears state', async () => {
    await store.join('c1');
    await store.leave();

    expect(signalR.leaveVoice).toHaveBeenCalledWith('c1');
    expect(voice.disconnect).toHaveBeenCalled();
    expect(store.activeChannelId()).toBeNull();
  });

  it('toggleMute() flips the mic and broadcasts the new state', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');

    store.toggleMute();

    expect(store.selfMuted()).toBe(true);
    expect(voice.setMicMuted).toHaveBeenCalledWith(true);
    expect(signalR.updateVoiceState).toHaveBeenCalledWith(true, false, false, false);
    expect(store.participantsOf('c1').find((p) => p.userId === 'me')?.isMuted).toBe(true);
  });

  it('toggleDeafen() mutes the mic too, and undeafening unmutes', async () => {
    await store.join('c1');

    store.toggleDeafen();
    expect(store.selfDeafened()).toBe(true);
    expect(store.selfMuted()).toBe(true);
    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(true, true, false, false);

    store.toggleDeafen();
    expect(store.selfDeafened()).toBe(false);
    expect(store.selfMuted()).toBe(false);
    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(false, false, false, false);
  });

  it('applyLeft for ourselves tears the connection down', async () => {
    await store.join('c1');
    store.applyLeft('c1', 'me'); // server evicted us (joined voice elsewhere)

    expect(store.activeChannelId()).toBeNull();
    expect(voice.disconnect).toHaveBeenCalled();
  });

  it('toggleCamera() publishes and broadcasts the video flag', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');

    await store.toggleCamera();

    expect(voice.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(store.selfVideoOn()).toBe(true);
    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(false, false, true, false);
    expect(store.participantsOf('c1').find((p) => p.userId === 'me')?.isVideoOn).toBe(true);
  });

  it('toggleScreenShare() picker-cancel leaves streaming off', async () => {
    await store.join('c1');
    voice.setScreenShareEnabled.mockResolvedValue(false); // user dismissed the browser picker

    await store.toggleScreenShare();

    expect(store.selfStreaming()).toBe(false);
    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(false, false, false, false);
  });

  it('toggleMute() after toggleCamera() keeps broadcasting the live video flag', async () => {
    await store.join('c1');
    await store.toggleCamera();

    store.toggleMute();

    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(true, false, true, false);
  });

  it('applyStateUpdated for ourselves syncs the self flags (server clamp echo)', async () => {
    await store.join('c1');
    await store.toggleCamera();
    expect(store.selfVideoOn()).toBe(true);

    // The hub clamped video off (no UseVideo permission) — the echo snaps the toggle back.
    store.applyStateUpdated(participant({ userId: 'me', isVideoOn: false }));

    expect(store.selfVideoOn()).toBe(false);
  });

  it('leave() clears the video flags', async () => {
    voice.localScreenShareOn.set(true);
    await store.join('c1');
    await store.toggleCamera();
    await store.toggleScreenShare();

    await store.leave();

    expect(store.selfVideoOn()).toBe(false);
    expect(store.selfStreaming()).toBe(false);
  });

  it("the browser's own Stop-sharing rebroadcasts streaming off", async () => {
    voice.localScreenShareOn.set(true);
    await store.join('c1');
    await store.toggleScreenShare();
    expect(store.selfStreaming()).toBe(true);

    voice.localScreenShareOn.set(false); // LiveKit unpublished via the browser bar
    TestBed.tick(); // flush the sync effect

    expect(store.selfStreaming()).toBe(false);
    expect(signalR.updateVoiceState).toHaveBeenLastCalledWith(false, false, false, false);
  });

  // --- Slice B: bitrate, server moderation, click-to-watch/hide-video ---

  it("join() passes the channel's configured bitrate to connect()", async () => {
    channelsByGuild.set({ g1: [{ id: 'c1', bitrate: 32000 }] });

    await store.join('c1');

    expect(voice.connect).toHaveBeenCalledWith('c1', expect.any(Function), 32000);
  });

  it('a server-mute echo locks toggleMute() and forces the media mute', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');

    store.applyStateUpdated(participant({ userId: 'me', isServerMuted: true }));

    expect(store.selfServerMuted()).toBe(true);
    expect(voice.setMicMuted).toHaveBeenCalledWith(true); // media complies with the moderator

    voice.setMicMuted.mockClear();
    store.toggleMute(); // locked — only a moderator can lift a server mute
    expect(store.selfMuted()).toBe(false);
    expect(voice.setMicMuted).not.toHaveBeenCalled();
  });

  it('lifting a server mute restores the mic unless self-muted underneath', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me', isServerMuted: true })]);
    await store.join('c1');
    expect(store.selfServerMuted()).toBe(true);

    store.applyStateUpdated(participant({ userId: 'me', isServerMuted: false }));

    expect(store.selfServerMuted()).toBe(false);
    expect(voice.setMicMuted).toHaveBeenLastCalledWith(false);
  });

  it('a server-deafen echo locks toggleDeafen() and applies the media deafen', async () => {
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');

    store.applyStateUpdated(participant({ userId: 'me', isServerDeafened: true }));

    expect(store.selfServerDeafened()).toBe(true);
    expect(voice.setDeafened).toHaveBeenCalledWith(true);

    store.toggleDeafen();
    expect(store.selfDeafened()).toBe(false); // locked
  });

  it('serverMute/serverDeafen/moveParticipant invoke the hub and rethrow rejections', async () => {
    await store.serverMute('u2', true);
    expect(signalR.moderateVoiceState).toHaveBeenCalledWith('u2', true, null);

    await store.serverDeafen('u2', true);
    expect(signalR.moderateVoiceState).toHaveBeenCalledWith('u2', null, true);

    await store.moveParticipant('u2', 'c2');
    expect(signalR.moveVoiceParticipant).toHaveBeenCalledWith('u2', 'c2');

    signalR.moderateVoiceState.mockRejectedValue(new Error('denied'));
    await expect(store.serverMute('u2', true)).rejects.toThrow('denied');
  });

  it('VoiceForceMoved reconnects to the destination when we are in the source room', async () => {
    await store.join('c1');
    voice.connect.mockClear();

    TestBed.inject(GatewayEvents).emit({
      type: 'VoiceForceMoved',
      payload: { fromChannelId: 'c1', toChannelId: 'c2', guildId: 'g1' },
    });
    await Promise.resolve(); // let the fired join() start
    await vi.waitFor(() => expect(store.activeChannelId()).toBe('c2'));

    expect(voice.connect).toHaveBeenCalledWith('c2', expect.any(Function), null);
    // The old room's Redis state already moved server-side — the reconnect must NOT LeaveVoice it.
    expect(signalR.leaveVoice).not.toHaveBeenCalled();
  });

  it('VoiceForceMoved reconnects even when the LiveKit kick raced ahead (drop first)', async () => {
    await store.join('c1');
    // The store registered an onEnded (2nd connect arg); simulate the server's LiveKit removal
    // firing BEFORE the VoiceForceMoved signal — the unexpected drop resets our active channel.
    const onEnded = voice.connect.mock.calls[0][1] as () => void;
    voice.connect.mockClear();
    onEnded();
    expect(store.activeChannelId()).toBeNull();

    // The move signal arrives within the grace window — we still reconnect (lastRoomChannelId
    // remembers we held the source room) and the deferred leave is cancelled.
    TestBed.inject(GatewayEvents).emit({
      type: 'VoiceForceMoved',
      payload: { fromChannelId: 'c1', toChannelId: 'c2', guildId: 'g1' },
    });
    await vi.waitFor(() => expect(store.activeChannelId()).toBe('c2'));

    expect(voice.connect).toHaveBeenCalledWith('c2', expect.any(Function), null);
    expect(signalR.leaveVoice).not.toHaveBeenCalled();
  });

  it('VoiceForceMoved for a room we are not in is ignored', async () => {
    await store.join('c1');
    voice.connect.mockClear();

    TestBed.inject(GatewayEvents).emit({
      type: 'VoiceForceMoved',
      payload: { fromChannelId: 'other', toChannelId: 'c2', guildId: 'g1' },
    });
    await Promise.resolve();

    expect(store.activeChannelId()).toBe('c1');
    expect(voice.connect).not.toHaveBeenCalled();
  });

  it('toggleWatchStream opts in per user, and the stream ending revokes it', () => {
    store.applyJoined(participant({ userId: 'u2', isStreaming: true }));

    expect(store.isWatchingStream('u2')).toBe(false);
    store.toggleWatchStream('u2');
    expect(store.isWatchingStream('u2')).toBe(true);

    // Stream ends → the opt-in is revoked; restarting needs a fresh click.
    store.applyStateUpdated(participant({ userId: 'u2', isStreaming: false }));
    expect(store.isWatchingStream('u2')).toBe(false);
  });

  it('toggleHideVideo hides per user and survives roster updates', () => {
    store.applyJoined(participant({ userId: 'u2', isVideoOn: true }));

    store.toggleHideVideo('u2');
    expect(store.isVideoHidden('u2')).toBe(true);

    store.applyStateUpdated(participant({ userId: 'u2', isVideoOn: false }));
    expect(store.isVideoHidden('u2')).toBe(true); // a viewer preference, not tied to the flag

    store.toggleHideVideo('u2');
    expect(store.isVideoHidden('u2')).toBe(false);
  });

  it('leave() clears the watch opt-ins', async () => {
    await store.join('c1');
    store.toggleWatchStream('u2');
    expect(store.isWatchingStream('u2')).toBe(true);

    await store.leave();
    expect(store.isWatchingStream('u2')).toBe(false);
  });

  it('toggleWatchStream syncs the watch set into the media layer (stream-audio gating)', () => {
    store.toggleWatchStream('u2');
    TestBed.tick(); // flush the sync effect

    expect(voice.syncWatchedStreams).toHaveBeenLastCalledWith(new Set(['u2']));

    store.toggleWatchStream('u2');
    TestBed.tick();
    expect(voice.syncWatchedStreams).toHaveBeenLastCalledWith(new Set());
  });

  // --- alone-in-guild-channel media suspension (phantom presence) ---

  it('suspends media after 5 min alone in a guild channel — signaling and UI stay connected', async () => {
    vi.useFakeTimers();
    channelsByGuild.set({ g1: [{ id: 'c1', bitrate: null }] });
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');
    voice.disconnect.mockClear();

    TestBed.tick(); // arm the alone-timer effect
    await vi.advanceTimersByTimeAsync(300_000);

    expect(voice.disconnect).toHaveBeenCalled(); // the media room dropped…
    expect(store.mediaSuspended()).toBe(true);
    expect(store.activeChannelId()).toBe('c1'); // …but we still look (and count as) connected
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['me']);
    expect(signalR.leaveVoice).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('the first joiner auto-resumes suspended media, re-applying the mute state', async () => {
    vi.useFakeTimers();
    channelsByGuild.set({ g1: [{ id: 'c1', bitrate: null }] });
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');
    store.toggleMute(); // the toggle the user still sees must survive the resume
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(store.mediaSuspended()).toBe(true);
    voice.connect.mockClear();
    voice.setMicMuted.mockClear();

    TestBed.inject(GatewayEvents).emit({
      type: 'VoiceParticipantJoined',
      payload: participant({ userId: 'u2' }),
    });
    await vi.advanceTimersByTimeAsync(0); // flush the async resume

    expect(store.mediaSuspended()).toBe(false);
    expect(voice.connect).toHaveBeenCalledWith('c1', expect.any(Function), null);
    expect(voice.setMicMuted).toHaveBeenCalledWith(true);
    expect(store.activeChannelId()).toBe('c1');
    expect(signalR.leaveVoice).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not suspend while your own camera or screenshare is on', async () => {
    vi.useFakeTimers();
    channelsByGuild.set({ g1: [{ id: 'c1', bitrate: null }] });
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');
    await store.toggleCamera();
    voice.disconnect.mockClear();

    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(store.mediaSuspended()).toBe(false);
    expect(voice.disconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not suspend a DM call (CallStore owns the DM alone-timeout)', async () => {
    vi.useFakeTimers();
    voice.getParticipants.mockResolvedValue([
      participant({ userId: 'me', channelId: 'dm1', guildId: null }),
    ]);
    await store.join('dm1');
    voice.disconnect.mockClear();

    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(store.mediaSuspended()).toBe(false);
    expect(voice.disconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('leave() while suspended leaves cleanly without reconnecting', async () => {
    vi.useFakeTimers();
    channelsByGuild.set({ g1: [{ id: 'c1', bitrate: null }] });
    voice.getParticipants.mockResolvedValue([participant({ userId: 'me' })]);
    await store.join('c1');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(store.mediaSuspended()).toBe(true);
    voice.connect.mockClear();

    await store.leave();

    expect(signalR.leaveVoice).toHaveBeenCalledWith('c1');
    expect(store.activeChannelId()).toBeNull();
    expect(store.mediaSuspended()).toBe(false);
    expect(voice.connect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
