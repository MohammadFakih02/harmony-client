import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CallStore } from './call.store';
import { VoiceStore } from './voice.store';
import { DmStore } from './dm.store';
import { GatewayEvents } from '../hub/gateway-events';
import { SignalRService } from '../services/signalr.service';
import { VoiceService } from '../services/voice.service';
import { RingtoneService } from '../services/ringtone.service';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth.service';
import { IncomingCallPayload, VoiceParticipant } from '../models/voice.models';
import { DirectMessageChannel } from '../models/direct-message.models';

function ring(over: Partial<IncomingCallPayload> = {}): IncomingCallPayload {
  return { channelId: 'dm1', callerId: 'caller', startedAt: 1, ...over };
}

function participant(over: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    channelId: 'dm1',
    guildId: null,
    userId: 'caller',
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

function dm(over: Partial<DirectMessageChannel> = {}): DirectMessageChannel {
  return {
    channelId: 'dm1',
    isGroup: false,
    name: null,
    iconKey: null,
    lastReadId: '0',
    participants: [{ userId: 'caller', username: 'alice', avatarKey: null }],
    ...over,
  };
}

describe('CallStore', () => {
  let store: InstanceType<typeof CallStore>;
  let voiceStore: InstanceType<typeof VoiceStore>;
  let gateway: GatewayEvents;
  let dms: DirectMessageChannel[];
  let signalR: {
    joinVoice: ReturnType<typeof vi.fn>;
    leaveVoice: ReturnType<typeof vi.fn>;
    updateVoiceState: ReturnType<typeof vi.fn>;
    startCall: ReturnType<typeof vi.fn>;
    cancelCall: ReturnType<typeof vi.fn>;
    declineCall: ReturnType<typeof vi.fn>;
  };
  let ringtone: {
    playIncoming: ReturnType<typeof vi.fn>;
    playOutgoing: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let toast: { info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    dms = [dm()];
    signalR = {
      joinVoice: vi.fn().mockResolvedValue(undefined),
      leaveVoice: vi.fn().mockResolvedValue(undefined),
      updateVoiceState: vi.fn(),
      startCall: vi.fn().mockResolvedValue(undefined),
      cancelCall: vi.fn(),
      declineCall: vi.fn(),
    };
    ringtone = { playIncoming: vi.fn(), playOutgoing: vi.fn(), stop: vi.fn() };
    toast = { info: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        CallStore,
        VoiceStore,
        { provide: SignalRService, useValue: signalR },
        {
          provide: VoiceService,
          useValue: {
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            getParticipants: vi.fn().mockResolvedValue([]),
            setMicMuted: vi.fn(),
            setDeafened: vi.fn(),
            speakingUserIds: signal<ReadonlySet<string>>(new Set()),
            localScreenShareOn: signal(false),
          },
        },
        { provide: RingtoneService, useValue: ringtone },
        { provide: ToastService, useValue: toast },
        { provide: DmStore, useValue: { find: (id: string) => dms.find((d) => d.channelId === id) } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      ],
    });
    store = TestBed.inject(CallStore);
    voiceStore = TestBed.inject(VoiceStore);
    gateway = TestBed.inject(GatewayEvents);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an IncomingCall sets the ring state and starts the ringtone', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });

    expect(store.incoming()?.channelId).toBe('dm1');
    expect(ringtone.playIncoming).toHaveBeenCalled();
  });

  it('ignores an own ring echoed to another tab', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring({ callerId: 'me' }) });
    expect(store.incoming()).toBeNull();
  });

  it('first ring wins while one is showing', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    gateway.emit({ type: 'IncomingCall', payload: ring({ channelId: 'dm2', callerId: 'other' }) });

    expect(store.incoming()?.channelId).toBe('dm1');
  });

  it('ignores a ring for the call we are already in', async () => {
    await voiceStore.join('dm1');
    gateway.emit({ type: 'IncomingCall', payload: ring() });

    expect(store.incoming()).toBeNull();
  });

  it('CallCancelled dismisses the matching ring and stops the ringtone', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    gateway.emit({ type: 'CallCancelled', payload: { channelId: 'dm1' } });

    expect(store.incoming()).toBeNull();
    expect(ringtone.stop).toHaveBeenCalled();
  });

  it('an unanswered ring auto-dismisses after 60s', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    vi.advanceTimersByTime(60_000);

    expect(store.incoming()).toBeNull();
  });

  it('accept() joins the room and clears the ring', async () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    await store.accept();

    expect(store.incoming()).toBeNull();
    expect(ringtone.stop).toHaveBeenCalled();
    expect(signalR.joinVoice).toHaveBeenCalledWith('dm1');
    expect(voiceStore.activeChannelId()).toBe('dm1');
  });

  it('decline() clears the ring and tells the hub', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    store.decline();

    expect(store.incoming()).toBeNull();
    expect(signalR.declineCall).toHaveBeenCalledWith('dm1');
  });

  it('a self VoiceParticipantJoined dismisses the ring (answered on another tab)', () => {
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    gateway.emit({ type: 'VoiceParticipantJoined', payload: participant({ userId: 'me' }) });

    expect(store.incoming()).toBeNull();
  });

  it('dismisses the ring when the ringing room empties (caller crash)', () => {
    gateway.emit({ type: 'VoiceParticipantJoined', payload: participant({ userId: 'caller' }) });
    gateway.emit({ type: 'IncomingCall', payload: ring() });
    gateway.emit({
      type: 'VoiceParticipantLeft',
      payload: { channelId: 'dm1', guildId: null, userId: 'caller' },
    });

    expect(store.incoming()).toBeNull();
  });

  it('startCall() joins the room, rings, and plays the outgoing sound', async () => {
    await store.startCall('dm1');

    expect(voiceStore.activeChannelId()).toBe('dm1');
    expect(signalR.startCall).toHaveBeenCalledWith('dm1');
    expect(store.outgoing()?.channelId).toBe('dm1');
    expect(ringtone.playOutgoing).toHaveBeenCalled();
  });

  it('startCall() swallows a hub rejection and stays in the call (occupied race)', async () => {
    signalR.startCall.mockRejectedValue(new Error('A call is already in progress.'));
    await store.startCall('dm1');

    expect(store.outgoing()).toBeNull();
    expect(voiceStore.activeChannelId()).toBe('dm1');
  });

  it('an unanswered outgoing ring times out: cancelCall(missed) + leave', async () => {
    await store.startCall('dm1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.outgoing()).toBeNull();
    expect(signalR.cancelCall).toHaveBeenCalledWith('dm1', true);
    expect(voiceStore.activeChannelId()).toBeNull();
  });

  it('the callee answering clears the outgoing ring and we stay in the call', async () => {
    await store.startCall('dm1');
    gateway.emit({ type: 'VoiceParticipantJoined', payload: participant({ userId: 'caller' }) });

    expect(store.outgoing()).toBeNull();
    expect(voiceStore.activeChannelId()).toBe('dm1');
    expect(signalR.cancelCall).not.toHaveBeenCalled();
  });

  it('a 1:1 decline hangs the caller up: toast + leave + cancelCall(not missed)', async () => {
    await store.startCall('dm1');
    gateway.emit({ type: 'CallDeclined', payload: { channelId: 'dm1', userId: 'caller' } });
    await Promise.resolve();

    expect(toast.info).toHaveBeenCalledWith('alice declined the call', 'fa-phone-slash');
    expect(store.outgoing()).toBeNull();
    expect(signalR.cancelCall).toHaveBeenCalledWith('dm1', false);
    expect(voiceStore.activeChannelId()).toBeNull();
  });

  it('a group decline only toasts — the others keep ringing', async () => {
    dms = [
      dm({
        isGroup: true,
        participants: [
          { userId: 'caller', username: 'alice', avatarKey: null },
          { userId: 'u3', username: 'bob', avatarKey: null },
        ],
      }),
    ];
    await store.startCall('dm1');
    gateway.emit({ type: 'CallDeclined', payload: { channelId: 'dm1', userId: 'caller' } });

    expect(toast.info).toHaveBeenCalled();
    expect(store.outgoing()?.channelId).toBe('dm1');
    expect(voiceStore.activeChannelId()).toBe('dm1');
  });

  it('leaving the room by any path while ringing cancels with missed=true', async () => {
    await store.startCall('dm1');
    await voiceStore.leave(); // e.g. the voice-bar disconnect button
    TestBed.tick(); // flush the leave-while-ringing effect

    expect(store.outgoing()).toBeNull();
    expect(signalR.cancelCall).toHaveBeenCalledWith('dm1', true);
  });
});
