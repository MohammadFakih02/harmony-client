import { ageFromIso } from './user.models';

describe('ageFromIso', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // local 2026-06-15
  });
  afterEach(() => vi.useRealTimers());

  it('returns null for null/empty/invalid input', () => {
    expect(ageFromIso(null)).toBeNull();
    expect(ageFromIso('')).toBeNull();
    expect(ageFromIso('not-a-date')).toBeNull();
  });

  it('counts a birthday that has already passed this year', () => {
    expect(ageFromIso('2000-01-10')).toBe(26);
  });

  it('does not count a birthday that has not yet occurred this year', () => {
    expect(ageFromIso('2000-12-31')).toBe(25);
  });

  it('counts the year when the birthday is today', () => {
    expect(ageFromIso('2000-06-15')).toBe(26);
  });
});
