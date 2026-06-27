import { extractInviteCodes } from './invite-links';

describe('extractInviteCodes', () => {
  it('extracts a code from a full invite link', () => {
    expect(extractInviteCodes('join us http://localhost:4200/invite/AbC123')).toEqual(['AbC123']);
  });

  it('matches the API /invites/ form too', () => {
    expect(extractInviteCodes('https://harmony.app/invites/XyZ789/join')).toEqual(['XyZ789']);
  });

  it('ignores a bare code with no link', () => {
    expect(extractInviteCodes('the code is AbC123, paste it')).toEqual([]);
  });

  it('stops the code at trailing punctuation', () => {
    expect(extractInviteCodes('here: https://harmony.app/invite/AbC123.')).toEqual(['AbC123']);
  });

  it('dedupes a repeated link but keeps distinct ones in order', () => {
    const content =
      'https://h.app/invite/AAA and https://h.app/invite/AAA then https://h.app/invite/BBB';
    expect(extractInviteCodes(content)).toEqual(['AAA', 'BBB']);
  });

  it('returns empty for content with no links', () => {
    expect(extractInviteCodes('just a normal message')).toEqual([]);
  });
});
