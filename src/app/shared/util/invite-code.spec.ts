import { extractInviteCode } from './invite-code';

describe('extractInviteCode', () => {
  it('returns a bare code unchanged', () => {
    expect(extractInviteCode('aBc12Xy')).toBe('aBc12Xy');
  });

  it('trims surrounding whitespace', () => {
    expect(extractInviteCode('  aBc12Xy  ')).toBe('aBc12Xy');
  });

  it('extracts from a frontend invite link (/invite/CODE)', () => {
    expect(extractInviteCode('https://harmony.app/invite/aBc12Xy')).toBe('aBc12Xy');
  });

  it('extracts from the API form (/invites/CODE/join)', () => {
    expect(extractInviteCode('http://localhost:5057/api/invites/aBc12Xy/join')).toBe('aBc12Xy');
  });

  it('falls back to the last path segment for an unexpected shape', () => {
    expect(extractInviteCode('https://example.com/x/y/zzz')).toBe('zzz');
  });

  it('returns empty string for empty input', () => {
    expect(extractInviteCode('   ')).toBe('');
  });
});
