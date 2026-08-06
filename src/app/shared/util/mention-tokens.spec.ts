import { tokenizeMentions } from './mention-tokens';

describe('tokenizeMentions', () => {
  const known = new Set(['alice', 'bob']);

  it('returns a single plain token when there are no mentions', () => {
    const tokens = tokenizeMentions('just a normal message', known);
    expect(tokens).toEqual([{ text: 'just a normal message', isMention: false }]);
  });

  it('splits a known @username into a mention token', () => {
    const tokens = tokenizeMentions('hey @alice!', known);
    expect(tokens).toEqual([
      { text: 'hey ', isMention: false },
      { text: '@alice', isMention: true },
      { text: '!', isMention: false },
    ]);
  });

  it('is case-insensitive when matching the known-username set', () => {
    const tokens = tokenizeMentions('@ALICE', known);
    expect(tokens).toEqual([{ text: '@ALICE', isMention: true }]);
  });

  it('does not chip an unknown username', () => {
    const tokens = tokenizeMentions('@stranger says hi', known);
    expect(tokens).toEqual([{ text: '@stranger', isMention: false }, { text: ' says hi', isMention: false }]);
  });

  it('always chips @everyone and @here regardless of the known-username set', () => {
    const tokens = tokenizeMentions('@everyone @here', known);
    expect(tokens).toEqual([
      { text: '@everyone', isMention: true },
      { text: ' ', isMention: false },
      { text: '@here', isMention: true },
    ]);
  });

  it('terminates a token at punctuation', () => {
    const tokens = tokenizeMentions('@bob, hi', known);
    expect(tokens).toEqual([
      { text: '@bob', isMention: true },
      { text: ', hi', isMention: false },
    ]);
  });

  it('handles multiple mentions in one message', () => {
    const tokens = tokenizeMentions('@alice and @bob', known);
    expect(tokens).toEqual([
      { text: '@alice', isMention: true },
      { text: ' and ', isMention: false },
      { text: '@bob', isMention: true },
    ]);
  });

  it('returns an empty array for empty content', () => {
    expect(tokenizeMentions('', known)).toEqual([]);
  });
});
