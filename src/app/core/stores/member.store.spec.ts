import { TestBed } from '@angular/core/testing';
import { MemberStore } from './member.store';
import { MemberService } from '../services/member.service';
import { GuildMember } from '../models/member.models';

const makeMember = (overrides: Partial<GuildMember> & { userId: string; username: string }): GuildMember => ({
  nickname: null,
  avatarKey: null,
  isOwner: false,
  joinedAt: 0,
  communicationDisabledUntil: null,
  roleIds: [],
  ...overrides,
});

describe('MemberStore', () => {
  let store: InstanceType<typeof MemberStore>;
  let service: {
    getMembers: ReturnType<typeof vi.fn>;
    getCapabilities: ReturnType<typeof vi.fn>;
    kick: ReturnType<typeof vi.fn>;
    ban: ReturnType<typeof vi.fn>;
    timeout: ReturnType<typeof vi.fn>;
    clearTimeout: ReturnType<typeof vi.fn>;
  };

  const caps = {
    canManageGuild: false, canManageChannels: false, canManageRoles: false,
    canCreateInvite: true, canManageInvites: false,
    canKick: true, canBan: true, canTimeout: true, canViewAuditLog: false,
  };

  beforeEach(() => {
    service = {
      getMembers: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue(caps),
      kick: vi.fn().mockResolvedValue(undefined),
      ban: vi.fn().mockResolvedValue(undefined),
      timeout: vi.fn().mockResolvedValue(undefined),
      clearTimeout: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [MemberStore, { provide: MemberService, useValue: service }],
    });
    store = TestBed.inject(MemberStore);
  });

  it('starts with no cached members', () => {
    expect(store.membersOf('1')).toEqual([]);
  });

  it('loadIfNeeded() fetches and caches members keyed by guildId', async () => {
    const members = [makeMember({ userId: '10', username: 'alice' })];
    service.getMembers.mockResolvedValue(members);

    await store.loadIfNeeded('1');

    expect(store.membersOf('1')).toEqual(members);
    expect(service.getMembers).toHaveBeenCalledWith('1');
  });

  it('loadIfNeeded() is a no-op when the guild is already cached', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    await store.loadIfNeeded('1');

    expect(service.getMembers).toHaveBeenCalledTimes(1);
  });

  it('caches separate guilds independently', async () => {
    service.getMembers.mockImplementation((guildId: string) =>
      Promise.resolve([makeMember({ userId: guildId, username: `user-${guildId}` })]),
    );

    await store.loadIfNeeded('1');
    await store.loadIfNeeded('2');

    expect(store.membersOf('1')).toHaveLength(1);
    expect(store.membersOf('1')[0].userId).toBe('1');
    expect(store.membersOf('2')[0].userId).toBe('2');
  });

  it('leaves the cache empty when the fetch fails', async () => {
    service.getMembers.mockRejectedValue(new Error('network error'));

    await store.loadIfNeeded('1');

    expect(store.membersOf('1')).toEqual([]);
  });

  it('loadCapabilitiesIfNeeded() fetches once and caches', async () => {
    await store.loadCapabilitiesIfNeeded('1');
    await store.loadCapabilitiesIfNeeded('1');

    expect(store.capabilitiesOf('1')).toEqual(caps);
    expect(service.getCapabilities).toHaveBeenCalledTimes(1);
  });

  it('kick() calls the API then removes the member locally', async () => {
    service.getMembers.mockResolvedValue([
      makeMember({ userId: '10', username: 'alice' }),
      makeMember({ userId: '20', username: 'bob' }),
    ]);
    await store.loadIfNeeded('1');

    await store.kick('1', '10');

    expect(service.kick).toHaveBeenCalledWith('1', '10');
    expect(store.membersOf('1').map((m) => m.userId)).toEqual(['20']);
  });

  it('ban() calls the API with the reason then removes the member locally', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    await store.ban('1', '10', 'spam');

    expect(service.ban).toHaveBeenCalledWith('1', '10', 'spam');
    expect(store.membersOf('1')).toEqual([]);
  });

  it('timeout() sets communicationDisabledUntil; clearTimeout() resets it', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    await store.timeout('1', '10', 600);
    expect(service.timeout).toHaveBeenCalledWith('1', '10', 600);
    expect(store.membersOf('1')[0].communicationDisabledUntil).toBeGreaterThan(Date.now());

    await store.clearTimeout('1', '10');
    expect(store.membersOf('1')[0].communicationDisabledUntil).toBeNull();
  });

  it('applyMemberUpdated() patches only the targeted member', async () => {
    service.getMembers.mockResolvedValue([
      makeMember({ userId: '10', username: 'alice' }),
      makeMember({ userId: '20', username: 'bob' }),
    ]);
    await store.loadIfNeeded('1');

    store.applyMemberUpdated('1', '20', 12345);

    expect(store.membersOf('1').find((m) => m.userId === '10')!.communicationDisabledUntil).toBeNull();
    expect(store.membersOf('1').find((m) => m.userId === '20')!.communicationDisabledUntil).toBe(12345);
  });
});
