import {
  overridePermGroups,
  overrideStateOf,
  withOverrideState,
} from './channel-override.utils';

const VIEW = 1 << 0;
const SEND = 1 << 8;
const CONNECT = 1 << 17;

describe('overrideStateOf', () => {
  it('reads allow / deny / neutral from the masks', () => {
    expect(overrideStateOf(VIEW, 0, VIEW)).toBe('allow');
    expect(overrideStateOf(0, VIEW, VIEW)).toBe('deny');
    expect(overrideStateOf(0, 0, VIEW)).toBe('neutral');
  });

  it('only reports the queried bit, not neighbours', () => {
    expect(overrideStateOf(SEND, VIEW, SEND)).toBe('allow');
    expect(overrideStateOf(SEND, VIEW, VIEW)).toBe('deny');
    expect(overrideStateOf(SEND, VIEW, CONNECT)).toBe('neutral');
  });
});

describe('withOverrideState', () => {
  it('sets a bit into the chosen mask', () => {
    expect(withOverrideState(0, 0, VIEW, 'allow')).toEqual({ allowBits: VIEW, denyBits: 0 });
    expect(withOverrideState(0, 0, VIEW, 'deny')).toEqual({ allowBits: 0, denyBits: VIEW });
  });

  it('moving allow → deny clears the allow bit (masks never overlap)', () => {
    const next = withOverrideState(VIEW | SEND, 0, VIEW, 'deny');
    expect(next).toEqual({ allowBits: SEND, denyBits: VIEW });
    expect(next.allowBits & next.denyBits).toBe(0);
  });

  it('neutral clears the bit from both masks and leaves others intact', () => {
    expect(withOverrideState(VIEW, SEND, VIEW, 'neutral')).toEqual({
      allowBits: 0,
      denyBits: SEND,
    });
  });

  it('is idempotent when re-applying the current state', () => {
    expect(withOverrideState(VIEW, 0, VIEW, 'allow')).toEqual({ allowBits: VIEW, denyBits: 0 });
  });
});

describe('overridePermGroups', () => {
  it('text channels get the trimmed General pair + the Text group only', () => {
    const groups = overridePermGroups('text');
    expect(groups.map((g) => g.category)).toEqual(['General', 'Text']);
    expect(groups[0].perms.map((p) => p.label)).toEqual(['View Channels', 'Manage Channels']);
  });

  it('voice channels get the Voice group instead of Text', () => {
    const groups = overridePermGroups('voice');
    expect(groups.map((g) => g.category)).toEqual(['General', 'Voice']);
    expect(groups[1].perms.some((p) => p.label === 'Connect')).toBe(true);
  });

  it('never offers guild-scoped bits (Administrator, Kick, Ban, ...)', () => {
    const labels = overridePermGroups('text').flatMap((g) => g.perms.map((p) => p.label));
    expect(labels).not.toContain('Administrator');
    expect(labels).not.toContain('Kick Members');
    expect(labels).not.toContain('Manage Server');
  });
});
