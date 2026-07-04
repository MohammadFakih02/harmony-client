import { TestBed } from '@angular/core/testing';
import { MemberStore } from './member.store';
import { MemberService } from '../services/member.service';
import { GuildMember } from '../models/member.models';
import { GatewayEvents } from '../hub/gateway-events';

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
    getChannelViewers: ReturnType<typeof vi.fn>;
    kick: ReturnType<typeof vi.fn>;
    ban: ReturnType<typeof vi.fn>;
    timeout: ReturnType<typeof vi.fn>;
    clearTimeout: ReturnType<typeof vi.fn>;
    setOwnNickname: ReturnType<typeof vi.fn>;
    setNickname: ReturnType<typeof vi.fn>;
  };

  const caps = {
    canManageGuild: false, canManageChannels: false, canManageRoles: false,
    canCreateInvite: true, canManageInvites: false,
    canKick: true, canBan: true, canTimeout: true, canViewAuditLog: false,
    canManageNicknames: false,
  };

  beforeEach(() => {
    service = {
      getMembers: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue(caps),
      getChannelViewers: vi.fn().mockResolvedValue([]),
      kick: vi.fn().mockResolvedValue(undefined),
      ban: vi.fn().mockResolvedValue(undefined),
      timeout: vi.fn().mockResolvedValue(undefined),
      clearTimeout: vi.fn().mockResolvedValue(undefined),
      setOwnNickname: vi.fn().mockResolvedValue(undefined),
      setNickname: vi.fn().mockResolvedValue(undefined),
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

  it('channelViewers() is null until loaded, then returns the cached set (fetched once)', async () => {
    expect(store.channelViewers('c1')).toBeNull();
    service.getChannelViewers.mockResolvedValue(['10', '20']);

    await store.loadViewersIfNeeded('1', 'c1');
    await store.loadViewersIfNeeded('1', 'c1');

    expect(store.channelViewers('c1')).toEqual(['10', '20']);
    expect(service.getChannelViewers).toHaveBeenCalledTimes(1);
  });

  it('leaves channelViewers() null when the fetch fails (fail open → show everyone)', async () => {
    service.getChannelViewers.mockRejectedValue(new Error('network error'));

    await store.loadViewersIfNeeded('1', 'c1');

    expect(store.channelViewers('c1')).toBeNull();
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

  it('applyAvatar() patches the user across every loaded guild', async () => {
    service.getMembers.mockImplementation((guildId: string) =>
      Promise.resolve([
        makeMember({ userId: '10', username: 'alice', avatarKey: null }),
        makeMember({ userId: '20', username: 'bob', avatarKey: null }),
      ]),
    );
    await store.loadIfNeeded('1');
    await store.loadIfNeeded('2');

    store.applyAvatar('10', 'avatars/10/99');

    expect(store.membersOf('1').find((m) => m.userId === '10')!.avatarKey).toBe('avatars/10/99');
    expect(store.membersOf('2').find((m) => m.userId === '10')!.avatarKey).toBe('avatars/10/99');
    expect(store.membersOf('1').find((m) => m.userId === '20')!.avatarKey).toBeNull();
  });

  it('setOwnNickname() calls the API then patches the member nickname', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    await store.setOwnNickname('1', '10', 'Ace');

    expect(service.setOwnNickname).toHaveBeenCalledWith('1', 'Ace');
    expect(store.membersOf('1')[0].nickname).toBe('Ace');
  });

  it('setNickname() renames another member locally after the API call', async () => {
    service.getMembers.mockResolvedValue([
      makeMember({ userId: '10', username: 'alice' }),
      makeMember({ userId: '20', username: 'bob' }),
    ]);
    await store.loadIfNeeded('1');

    await store.setNickname('1', '20', 'Bobby');

    expect(service.setNickname).toHaveBeenCalledWith('1', '20', 'Bobby');
    expect(store.membersOf('1').find((m) => m.userId === '20')!.nickname).toBe('Bobby');
    expect(store.membersOf('1').find((m) => m.userId === '10')!.nickname).toBeNull();
  });

  it('patchMember() applies nickname + timeout together without clobbering', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    store.patchMember('1', '10', { nickname: 'Ace', communicationDisabledUntil: 999 });

    const m = store.membersOf('1')[0];
    expect(m.nickname).toBe('Ace');
    expect(m.communicationDisabledUntil).toBe(999);
  });

  it('reacts to a MemberUpdated gateway event (self-subscribed in onInit)', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');

    TestBed.inject(GatewayEvents).emit({
      type: 'MemberUpdated',
      payload: { guildId: '1', userId: '10', nickname: 'Ace', communicationDisabledUntil: 999 },
    });

    const m = store.membersOf('1')[0];
    expect(m.nickname).toBe('Ace');
    expect(m.communicationDisabledUntil).toBe(999);
  });

  it('ignores a MemberUpdated gateway event for an unloaded guild (cache guard)', () => {
    TestBed.inject(GatewayEvents).emit({
      type: 'MemberUpdated',
      payload: { guildId: 'not-loaded', userId: '10', nickname: 'X', communicationDisabledUntil: 1 },
    });

    expect(store.membersOf('not-loaded')).toEqual([]);
  });

  it('adds a member on a MemberJoined gateway event (cache-guarded + idempotent)', async () => {
    service.getMembers.mockResolvedValue([makeMember({ userId: '10', username: 'alice' })]);
    await store.loadIfNeeded('1');
    const joined = makeMember({ userId: '20', username: 'bob' });

    // Unloaded guild → ignored.
    TestBed.inject(GatewayEvents).emit({ type: 'MemberJoined', payload: { guildId: 'nope', member: joined } });
    expect(store.membersOf('nope')).toEqual([]);

    // Loaded guild → appended.
    TestBed.inject(GatewayEvents).emit({ type: 'MemberJoined', payload: { guildId: '1', member: joined } });
    expect(store.membersOf('1').map((m) => m.userId)).toEqual(['10', '20']);

    // Duplicate join → no-op (idempotent).
    TestBed.inject(GatewayEvents).emit({ type: 'MemberJoined', payload: { guildId: '1', member: joined } });
    expect(store.membersOf('1').map((m) => m.userId)).toEqual(['10', '20']);
  });
});
