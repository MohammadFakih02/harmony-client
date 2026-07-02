import { MentionContext, buildMentionSets, matchMentionAt } from './mention-match';

const guildCtx: MentionContext = {
  sets: buildMentionSets(
    ['alice', 'john', 'john smith', 'bobby mcbobface'],
    [{ name: 'Server Admin', color: '#00ff00' }],
  ),
  guild: true,
};

// match at the first '@' in the string
const at = (s: string, ctx = guildCtx) => matchMentionAt(s, s.indexOf('@'), ctx);

describe('matchMentionAt', () => {
  it('matches a plain username', () => {
    expect(at('hi @alice')).toEqual({ length: 5, kind: 'user', color: null });
  });

  it('matches a multi-word nickname', () => {
    expect(at('@Bobby McBobface hi')).toEqual({ length: 15, kind: 'user', color: null });
  });

  it('prefers the longest candidate', () => {
    expect(at('@John Smith please')).toEqual({ length: 10, kind: 'user', color: null });
  });

  it('does not partial-match across a word boundary', () => {
    expect(at('@Johnson')).toBeNull();
  });

  it('matches a role name and carries its colour', () => {
    expect(at('@Server Admin')).toEqual({ length: 12, kind: 'role', color: '#00ff00' });
  });

  it('recognizes @everyone / @here only in a guild', () => {
    expect(at('@everyone')).toEqual({ length: 8, kind: 'everyone', color: null });
    expect(at('@here')).toEqual({ length: 4, kind: 'here', color: null });
    const dm: MentionContext = { sets: buildMentionSets(['alice'], []), guild: false };
    expect(at('@everyone', dm)).toBeNull();
  });

  it('ignores an email-like tail', () => {
    expect(matchMentionAt('mail me@alice.com', 'mail me'.length, guildCtx)).toBeNull();
  });

  it('returns null for an unknown token', () => {
    expect(at('@stranger')).toBeNull();
  });
});
