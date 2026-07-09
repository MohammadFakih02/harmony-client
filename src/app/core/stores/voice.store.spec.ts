import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VoiceStore } from './voice.store';
import { VoiceService } from '../services/voice.service';
import { SignalRService } from '../services/signalr.service';
import { AuthService } from '../services/auth.service';
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
    speakingUserIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  };
  let signalR: {
    joinVoice: ReturnType<typeof vi.fn>;
    leaveVoice: ReturnType<typeof vi.fn>;
    updateVoiceState: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    voice = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getParticipants: vi.fn().mockResolvedValue([]),
      setMicMuted: vi.fn(),
      setDeafened: vi.fn(),
      speakingUserIds: signal<ReadonlySet<string>>(new Set()),
    };
    signalR = {
      joinVoice: vi.fn().mockResolvedValue(undefined),
      leaveVoice: vi.fn().mockResolvedValue(undefined),
      updateVoiceState: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        VoiceStore,
        { provide: VoiceService, useValue: voice },
        { provide: SignalRService, useValue: signalR },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
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

    expect(voice.connect).toHaveBeenCalledWith('c1', expect.any(Function));
    expect(signalR.joinVoice).toHaveBeenCalledWith('c1');
    expect(store.activeChannelId()).toBe('c1');
    expect(store.inVoice()).toBe(true);
    expect(store.participantsOf('c1').map((p) => p.userId)).toEqual(['me']);
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
});
