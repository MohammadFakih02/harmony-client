import { mediaQuerySignal } from './viewport.service';

/** Minimal fake MediaQueryList: manual `matches` flip + listener dispatch. */
function fakeMql(initial: boolean) {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = {
    matches: initial,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (listener = fn),
    removeEventListener: () => {},
  } as unknown as MediaQueryList;
  return { mql, fire: (matches: boolean) => listener?.({ matches }) };
}

describe('mediaQuerySignal', () => {
  it('seeds from the initial matches value', () => {
    expect(mediaQuerySignal('(max-width: 767.98px)', () => fakeMql(true).mql)()).toBe(true);
    expect(mediaQuerySignal('(max-width: 767.98px)', () => fakeMql(false).mql)()).toBe(false);
  });

  it('tracks change events', () => {
    const { mql, fire } = fakeMql(false);
    const sig = mediaQuerySignal('(pointer: coarse)', () => mql);
    expect(sig()).toBe(false);
    fire(true);
    expect(sig()).toBe(true);
    fire(false);
    expect(sig()).toBe(false);
  });

  it('passes the query string through to the factory', () => {
    let seen = '';
    mediaQuerySignal('(max-width: 767.98px)', (q) => {
      seen = q;
      return fakeMql(false).mql;
    });
    expect(seen).toBe('(max-width: 767.98px)');
  });
});
