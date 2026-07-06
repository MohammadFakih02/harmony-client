import { TestBed } from '@angular/core/testing';
import { PresenceStore } from './presence.store';
import { PresenceService } from '../services/presence.service';
import { AuthService } from '../services/auth.service';

describe('PresenceStore', () => {
  let store: InstanceType<typeof PresenceStore>;
  let presence: {
    getStatuses: ReturnType<typeof vi.fn>;
    getMyProfile: ReturnType<typeof vi.fn>;
    setMyStatus: ReturnType<typeof vi.fn>;
    setCustomStatus: ReturnType<typeof vi.fn>;
  };
  let currentUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    presence = {
      getStatuses: vi.fn().mockResolvedValue({}),
      getMyProfile: vi.fn().mockResolvedValue({ preferredStatus: 'online', statusMessage: null }),
      setMyStatus: vi.fn().mockResolvedValue(undefined),
      setCustomStatus: vi.fn().mockResolvedValue(undefined),
    };
    currentUser = vi.fn().mockReturnValue({ id: 'me' });

    TestBed.configureTestingModule({
      providers: [
        PresenceStore,
        { provide: PresenceService, useValue: presence },
        { provide: AuthService, useValue: { currentUser } },
      ],
    });
    store = TestBed.inject(PresenceStore);
  });

  it('statusOf() defaults to offline for unknown users', () => {
    expect(store.statusOf('nobody')).toBe('offline');
  });

  it('loadStatuses() merges fetched statuses + messages', async () => {
    presence.getStatuses.mockResolvedValue({
      '1': { status: 'online', statusMessage: null },
      '2': { status: 'dnd', statusMessage: 'busy' },
    });

    await TestBed.runInInjectionContext(() => store.loadStatuses(['1', '2']));

    expect(store.statusOf('1')).toBe('online');
    expect(store.statusOf('2')).toBe('dnd');
    expect(store.statusMessageOf('2')).toBe('busy');
  });

  it('loadStatuses() dedupes already-requested ids (live updates keep them fresh)', async () => {
    presence.getStatuses.mockResolvedValue({ '1': { status: 'online', statusMessage: null } });

    await TestBed.runInInjectionContext(() => store.loadStatuses(['1']));
    await TestBed.runInInjectionContext(() => store.loadStatuses(['1', '2']));

    expect(presence.getStatuses).toHaveBeenCalledTimes(2);
    expect(presence.getStatuses).toHaveBeenLastCalledWith(['2']);
  });

  it('loadStatuses({ force: true }) refetches even already-requested ids (reconnect reconcile)', async () => {
    presence.getStatuses.mockResolvedValue({ '1': { status: 'online', statusMessage: null } });
    await TestBed.runInInjectionContext(() => store.loadStatuses(['1']));

    await TestBed.runInInjectionContext(() => store.loadStatuses(['1'], { force: true }));

    expect(presence.getStatuses).toHaveBeenCalledTimes(2);
    expect(presence.getStatuses).toHaveBeenLastCalledWith(['1']);
  });

  it('loadStatuses() does not let a stale server offline override our own known status', async () => {
    // Establish our own status first (as initMyStatus would on startup).
    await TestBed.runInInjectionContext(() => store.initMyStatus()); // preferred: 'online'
    // A just-connected user's Redis key isn't set yet → the server returns us as offline.
    presence.getStatuses.mockResolvedValue({
      me: { status: 'offline', statusMessage: null },
      '1': { status: 'online', statusMessage: null },
    });

    await TestBed.runInInjectionContext(() => store.loadStatuses(['me', '1']));

    expect(store.statusOf('me')).toBe('online'); // our own status is preserved
    expect(store.statusOf('1')).toBe('online');
  });

  it('applyOnline / applyOffline update a user’s status', () => {
    store.applyOnline({ userId: '1', status: 'online' });
    expect(store.statusOf('1')).toBe('online');

    store.applyOffline({ userId: '1' });
    expect(store.statusOf('1')).toBe('offline');
  });

  it('applyStatusChanged for another user stores the effective status verbatim', () => {
    store.applyStatusChanged({ userId: 'other', status: 'away', statusMessage: null });
    expect(store.statusOf('other')).toBe('away');
  });

  it('applyStatusChanged for self updates myStatus and masks invisible→offline in the dot map', () => {
    store.applyStatusChanged({ userId: 'me', status: 'invisible', statusMessage: null });

    expect(store.myStatus()).toBe('invisible'); // own picker shows the real choice
    expect(store.statusOf('me')).toBe('offline'); // others'-view map is masked
  });

  it('setMyStatus() optimistically updates and persists', async () => {
    await TestBed.runInInjectionContext(() => store.setMyStatus('dnd'));

    expect(store.myStatus()).toBe('dnd');
    expect(store.statusOf('me')).toBe('dnd');
    expect(presence.setMyStatus).toHaveBeenCalledWith('dnd', null);
  });

  it('setMyStatus() reverts on failure', async () => {
    presence.setMyStatus.mockRejectedValue(new Error('offline'));

    await TestBed.runInInjectionContext(() => store.setMyStatus('dnd'));

    expect(store.myStatus()).toBe('offline'); // reverted to the initial default
  });

  it('initMyStatus() loads the preferred status from the service', async () => {
    presence.getMyProfile.mockResolvedValue({ preferredStatus: 'away', statusMessage: 'brb' });

    await TestBed.runInInjectionContext(() => store.initMyStatus());

    expect(store.myStatus()).toBe('away');
    expect(store.myStatusMessage()).toBe('brb');
  });

  it('initMyStatus() seeds our own effective status into the dot map (masking invisible)', async () => {
    presence.getMyProfile.mockResolvedValue({ preferredStatus: 'away', statusMessage: null });
    await TestBed.runInInjectionContext(() => store.initMyStatus());
    expect(store.statusOf('me')).toBe('away');

    presence.getMyProfile.mockResolvedValue({ preferredStatus: 'invisible', statusMessage: null });
    await TestBed.runInInjectionContext(() => store.initMyStatus());
    expect(store.statusOf('me')).toBe('offline'); // invisible is masked in the others'-view map
  });
});
