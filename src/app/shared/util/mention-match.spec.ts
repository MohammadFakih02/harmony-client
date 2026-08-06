import {
  MentionContext,
  buildMentionSets,
  matchMentionAt,
  mentionContextEquals,
} from './mention-match';

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

describe('mentionContextEquals', () => {
  const build = (): MentionContext => ({
    sets: buildMentionSets(['alice', 'john'], [{ name: 'Admin', color: '#00ff00' }]),
    guild: true,
  });

  it('treats two independently-built identical contexts as equal', () => {
    expect(mentionContextEquals(build(), build())).toBe(true);
  });

  it('detects a changed guild flag', () => {
    expect(mentionContextEquals(build(), { ...build(), guild: false })).toBe(false);
  });

  it('detects an added or renamed member', () => {
    const b: MentionContext = {
      sets: buildMentionSets(['alice', 'john', 'newbie'], [{ name: 'Admin', color: '#00ff00' }]),
      guild: true,
    };
    expect(mentionContextEquals(build(), b)).toBe(false);
    const renamed: MentionContext = {
      sets: buildMentionSets(['alice', 'johnny'], [{ name: 'Admin', color: '#00ff00' }]),
      guild: true,
    };
    expect(mentionContextEquals(build(), renamed)).toBe(false);
  });

  it('detects a changed role colour even when names match', () => {
    const b: MentionContext = {
      sets: buildMentionSets(['alice', 'john'], [{ name: 'Admin', color: '#ff0000' }]),
      guild: true,
    };
    expect(mentionContextEquals(build(), b)).toBe(false);
  });
});
