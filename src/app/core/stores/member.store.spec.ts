import { TestBed } from '@angular/core/testing';
import { MemberStore } from './member.store';
import { MemberService } from '../services/member.service';
import { GuildMember } from '../models/member.models';

const makeMember = (overrides: Partial<GuildMember> & { userId: string; username: string }): GuildMember => ({
  nickname: null,
  avatarKey: null,
  isOwner: false,
  joinedAt: 0,
  ...overrides,
});

describe('MemberStore', () => {
  let store: InstanceType<typeof MemberStore>;
  let service: { getMembers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { getMembers: vi.fn() };
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
});
