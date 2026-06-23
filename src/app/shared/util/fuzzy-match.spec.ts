import { fuzzyFilter, fuzzyScore } from './fuzzy-match';

describe('fuzzyScore', () => {
  it('ranks prefix > substring > subsequence', () => {
    expect(fuzzyScore('own', 'owner')).toBe(3); // prefix
    expect(fuzzyScore('owner', 'seed_owner')).toBe(2); // substring
    expect(fuzzyScore('seed_oner', 'seed_owner')).toBe(1); // subsequence (dropped 'w')
  });

  it('matches case-insensitively and treats empty query as a top match', () => {
    expect(fuzzyScore('OWNER', 'seed_owner')).toBe(2);
    expect(fuzzyScore('', 'anything')).toBe(3);
  });

  it('returns null when the chars are not a subsequence', () => {
    expect(fuzzyScore('xyz', 'seed_owner')).toBeNull();
    expect(fuzzyScore('rowne', 'seed_owner')).toBeNull(); // out of order
  });
});

describe('fuzzyFilter', () => {
  const names = ['seed_owner', 'seed_admin', 'seed_member', 'bob'];

  it('finds "owner" via substring among unrelated names', () => {
    expect(fuzzyFilter(names, 'owner', (n) => n)).toEqual(['seed_owner']);
  });

  it('tolerates a typo (missing character) via subsequence', () => {
    expect(fuzzyFilter(names, 'seed_oner', (n) => n)).toEqual(['seed_owner']);
  });

  it('orders better matches first', () => {
    // "seed" is a prefix of all three seed_* names; relative input order is preserved.
    expect(fuzzyFilter(names, 'seed', (n) => n)).toEqual([
      'seed_owner',
      'seed_admin',
      'seed_member',
    ]);
  });
});
