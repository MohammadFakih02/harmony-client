import { TestBed } from '@angular/core/testing';
import { NotificationPreferenceStore } from './notification-preference.store';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import { NotificationPreferences } from '../models/notification-preference.models';

const allTrue: NotificationPreferences = {
  mentionsEnabled: true,
  repliesEnabled: true,
  friendRequests: true,
  guildInvites: true,
  pushEnabled: true,
};

describe('NotificationPreferenceStore', () => {
  let service: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      get: vi.fn().mockResolvedValue({ ...allTrue }),
      update: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        NotificationPreferenceStore,
        { provide: NotificationPreferenceService, useValue: service },
      ],
    });
  });

  function make() {
    return TestBed.inject(NotificationPreferenceStore);
  }

  it('load() pulls the preferences', async () => {
    const store = make();
    await store.load();
    expect(store.preferences()).toEqual(allTrue);
  });

  it('setFlag() optimistically updates then commits the server result', async () => {
    service.update.mockResolvedValue({ ...allTrue, mentionsEnabled: false });
    const store = make();
    await store.load();

    await store.setFlag('mentionsEnabled', false);

    expect(service.update).toHaveBeenCalledWith({ mentionsEnabled: false });
    expect(store.preferences()!.mentionsEnabled).toBe(false);
  });

  it('setFlag() reverts on failure', async () => {
    service.update.mockRejectedValue(new Error('boom'));
    const store = make();
    await store.load();

    await store.setFlag('pushEnabled', false);

    expect(store.preferences()!.pushEnabled).toBe(true); // reverted
  });
});
