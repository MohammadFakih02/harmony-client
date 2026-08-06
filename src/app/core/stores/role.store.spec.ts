import { TestBed } from '@angular/core/testing';
import { RoleStore } from './role.store';
import { RoleService } from '../services/role.service';
import { Role } from '../models/role.models';

const makeRole = (overrides: Partial<Role> & { id: string; guildId: string }): Role => ({
  name: 'role',
  color: 0,
  permissionBits: 0,
  position: 1,
  isHoisted: false,
  isMentionable: false,
  isDefault: false,
  ...overrides,
});

describe('RoleStore', () => {
  let store: InstanceType<typeof RoleStore>;
  let service: {
    getRoles: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = { getRoles: vi.fn(), createRole: vi.fn(), deleteRole: vi.fn() };
    TestBed.configureTestingModule({
      providers: [RoleStore, { provide: RoleService, useValue: service }],
    });
    store = TestBed.inject(RoleStore);
  });

  it('loadIfNeeded() fetches once and sorts by position desc', async () => {
    service.getRoles.mockResolvedValue([
      makeRole({ id: '1', guildId: 'g', position: 1 }),
      makeRole({ id: '2', guildId: 'g', position: 5 }),
    ]);

    await store.loadIfNeeded('g');
    await store.loadIfNeeded('g');

    expect(service.getRoles).toHaveBeenCalledTimes(1);
    expect(store.rolesOf('g').map((r) => r.id)).toEqual(['2', '1']);
  });

  it('create() upserts the new role into the cached list', async () => {
    service.getRoles.mockResolvedValue([makeRole({ id: '1', guildId: 'g', position: 5 })]);
    await store.loadIfNeeded('g');
    service.createRole.mockResolvedValue(makeRole({ id: '9', guildId: 'g', position: 1 }));

    await store.create('g', { name: 'new' });

    expect(store.rolesOf('g').map((r) => r.id)).toEqual(['1', '9']);
  });

  it('applyRoleUpserted() updates an existing role in place', async () => {
    service.getRoles.mockResolvedValue([makeRole({ id: '1', guildId: 'g', name: 'old' })]);
    await store.loadIfNeeded('g');

    store.applyRoleUpserted(makeRole({ id: '1', guildId: 'g', name: 'renamed' }));

    expect(store.rolesOf('g')[0].name).toBe('renamed');
  });

  it('applyRoleDeleted() removes the role', async () => {
    service.getRoles.mockResolvedValue([
      makeRole({ id: '1', guildId: 'g' }),
      makeRole({ id: '2', guildId: 'g' }),
    ]);
    await store.loadIfNeeded('g');

    store.applyRoleDeleted('g', '1');

    expect(store.rolesOf('g').map((r) => r.id)).toEqual(['2']);
  });

  it('remove() calls the API then prunes locally', async () => {
    service.getRoles.mockResolvedValue([makeRole({ id: '1', guildId: 'g' })]);
    await store.loadIfNeeded('g');
    service.deleteRole.mockResolvedValue(undefined);

    await store.remove('g', '1');

    expect(service.deleteRole).toHaveBeenCalledWith('g', '1');
    expect(store.rolesOf('g')).toEqual([]);
  });
});
