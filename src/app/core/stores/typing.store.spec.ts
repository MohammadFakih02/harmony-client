import { TestBed } from '@angular/core/testing';
import { TypingStore } from './typing.store';
import { GatewayEvents } from '../hub/gateway-events';
import { AuthService } from '../services/auth.service';

describe('TypingStore', () => {
  let store: InstanceType<typeof TypingStore>;
  let gateway: GatewayEvents;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TypingStore,
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
      ],
    });
    store = TestBed.inject(TypingStore);
    gateway = TestBed.inject(GatewayEvents);
  });

  it('adds a typing user to a channel', () => {
    store.applyStarted('c1', 'u1');
    expect(store.typersOf('c1')).toEqual(['u1']);
  });

  it('ignores the current user (never shows "you are typing")', () => {
    store.applyStarted('c1', 'me');
    expect(store.typersOf('c1')).toEqual([]);
  });

  it('dedupes a repeated start for the same user', () => {
    store.applyStarted('c1', 'u1');
    store.applyStarted('c1', 'u1');
    expect(store.typersOf('c1')).toEqual(['u1']);
  });

  it('removes a user on stop', () => {
    store.applyStarted('c1', 'u1');
    store.applyStarted('c1', 'u2');
    store.applyStopped('c1', 'u1');
    expect(store.typersOf('c1')).toEqual(['u2']);
  });

  it('reacts to TypingStarted / TypingStopped gateway events (self-subscribed)', () => {
    gateway.emit({ type: 'TypingStarted', payload: { channelId: 'c1', userId: 'u9' } });
    expect(store.typersOf('c1')).toEqual(['u9']);
    gateway.emit({ type: 'TypingStopped', payload: { channelId: 'c1', userId: 'u9' } });
    expect(store.typersOf('c1')).toEqual([]);
  });

  it("clears a user's typing when their message arrives", () => {
    store.applyStarted('c1', 'u1');
    gateway.emit({
      type: 'MessageReceived',
      message: { messageId: 'm1', channelId: 'c1', userId: 'u1' } as never,
    });
    expect(store.typersOf('c1')).toEqual([]);
  });

  it('auto-expires a typer after the TTL if no further signal arrives', () => {
    vi.useFakeTimers();
    try {
      store.applyStarted('c1', 'u1');
      expect(store.typersOf('c1')).toEqual(['u1']);
      vi.advanceTimersByTime(6001);
      expect(store.typersOf('c1')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
