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
});
