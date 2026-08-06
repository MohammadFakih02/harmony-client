import { createLongPressTracker } from './long-press';

describe('createLongPressTracker', () => {
  it('fires at the press origin when the pointer holds still', () => {
    const t = createLongPressTracker();
    expect(t.begin(1, 100, 200)).toBe(true);
    t.move(1, 103, 202); // within slop
    expect(t.tryFire()).toEqual({ x: 100, y: 200 });
  });

  it('movement past the slop cancels (scroll, not press)', () => {
    const t = createLongPressTracker({ delayMs: 500, slopPx: 10 });
    t.begin(1, 100, 200);
    t.move(1, 100, 215); // 15px > 10px slop
    expect(t.tryFire()).toBeNull();
  });

  it('lifting the pointer before the timer cancels', () => {
    const t = createLongPressTracker();
    t.begin(1, 50, 50);
    t.cancel();
    expect(t.tryFire()).toBeNull();
  });

  it('a second pointer aborts the gesture and does not start a new one', () => {
    const t = createLongPressTracker();
    expect(t.begin(1, 10, 10)).toBe(true);
    expect(t.begin(2, 90, 90)).toBe(false); // pinch/second finger
    expect(t.tryFire()).toBeNull();
  });

  it('movement from an unrelated pointer id is ignored', () => {
    const t = createLongPressTracker();
    t.begin(1, 10, 10);
    t.move(99, 500, 500);
    expect(t.tryFire()).toEqual({ x: 10, y: 10 });
  });

  it('tryFire consumes the press — a stale timer cannot double-fire', () => {
    const t = createLongPressTracker();
    t.begin(1, 10, 10);
    expect(t.tryFire()).toEqual({ x: 10, y: 10 });
    expect(t.tryFire()).toBeNull();
  });

  it('can track a fresh press after a cancelled one', () => {
    const t = createLongPressTracker();
    t.begin(1, 10, 10);
    t.cancel();
    expect(t.begin(2, 30, 40)).toBe(true);
    expect(t.tryFire()).toEqual({ x: 30, y: 40 });
  });
});
