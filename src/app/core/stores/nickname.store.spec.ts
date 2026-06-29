import { TestBed } from '@angular/core/testing';
import { NicknameStore } from './nickname.store';
import { NicknameService } from '../services/nickname.service';

describe('NicknameStore', () => {
  let store: InstanceType<typeof NicknameStore>;
  let service: {
    getMine: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      getMine: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [NicknameStore, { provide: NicknameService, useValue: service }],
    });
    store = TestBed.inject(NicknameStore);
  });

  it('starts empty', () => {
    expect(store.nicknameOf('1')).toBeNull();
  });

  it('load() fetches and caches the map once', async () => {
    service.getMine.mockResolvedValue({ '10': 'Buddy' });

    await store.load();
    await store.load(); // no-op second time

    expect(store.nicknameOf('10')).toBe('Buddy');
    expect(service.getMine).toHaveBeenCalledTimes(1);
  });

  it('load() fails open (leaves the map empty)', async () => {
    service.getMine.mockRejectedValue(new Error('network'));

    await store.load();

    expect(store.nicknameOf('10')).toBeNull();
  });

  it('set() optimistically stores the trimmed nickname and PUTs it', async () => {
    await store.set('10', '  Pal  ');

    expect(store.nicknameOf('10')).toBe('Pal');
    expect(service.set).toHaveBeenCalledWith('10', 'Pal');
  });

  it('set() with a blank value clears the alias (DELETE)', async () => {
    await store.set('10', 'Pal');
    service.set.mockClear();

    await store.set('10', '   ');

    expect(store.nicknameOf('10')).toBeNull();
    expect(service.clear).toHaveBeenCalledWith('10');
  });

  it('set() reverts the optimistic change when the API fails', async () => {
    service.set.mockRejectedValue(new Error('boom'));

    await store.set('10', 'Pal');

    expect(store.nicknameOf('10')).toBeNull();
  });

  it('remove() clears the alias and calls the API', async () => {
    await store.set('10', 'Pal');

    await store.remove('10');

    expect(store.nicknameOf('10')).toBeNull();
    expect(service.clear).toHaveBeenCalledWith('10');
  });
});
