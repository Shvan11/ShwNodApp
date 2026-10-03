import { describe, expect, it } from 'vitest';
import { ChairBeaconOrder } from './chair-beacon-order.js';

describe('ChairBeaconOrder (FE-F4-10)', () => {
  it('drops a CLEAR that arrives after the same tab’s newer LOAD', () => {
    const order = new ChairBeaconOrder();
    // The tab sent CLEAR(seq 5) then LOAD(seq 6); the network delivered them reversed.
    expect(order.accept('3', 'tabA', 6)).toBe(true);
    expect(order.accept('3', 'tabA', 5)).toBe(false);
  });

  it('applies in-order beacons', () => {
    const order = new ChairBeaconOrder();
    expect(order.accept('3', 'tabA', 1)).toBe(true);
    expect(order.accept('3', 'tabA', 2)).toBe(true);
    expect(order.accept('3', 'tabA', 3)).toBe(true);
  });

  it('keeps arrival order between different tabs (their counters are unrelated)', () => {
    const order = new ChairBeaconOrder();
    expect(order.accept('3', 'tabA', 50)).toBe(true);
    expect(order.accept('3', 'tabB', 1)).toBe(true);
    // A stale one from tabA is still caught after tabB spoke in between.
    expect(order.accept('3', 'tabA', 49)).toBe(false);
  });

  it('tracks chairs independently', () => {
    const order = new ChairBeaconOrder();
    expect(order.accept('1', 'tabA', 9)).toBe(true);
    expect(order.accept('2', 'tabA', 1)).toBe(true);
  });

  it('always accepts a beacon without src/seq (an older cached client)', () => {
    const order = new ChairBeaconOrder();
    expect(order.accept('3', 'tabA', 9)).toBe(true);
    expect(order.accept('3', undefined, undefined)).toBe(true);
  });

  it('forgets the oldest tab past its cap instead of growing forever', () => {
    const order = new ChairBeaconOrder();
    for (let i = 0; i < 40; i++) order.accept('3', `tab${i}`, 10);
    // tab0 was evicted, so its stale seq is no longer recognized as stale.
    expect(order.accept('3', 'tab0', 1)).toBe(true);
    // a recent tab is still remembered
    expect(order.accept('3', 'tab39', 1)).toBe(false);
  });
});
