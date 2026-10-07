import { describe, expect, it } from 'vitest';
import { idPrefixRanges } from './patient-lookup-id-ranges';

/** The definition the ranges replace: does this ID's decimal form start with the digits? */
const startsWith = (id: number, digits: string): boolean => String(id).startsWith(digits);
const inRanges = (id: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([lo, hi]) => id >= lo && id <= hi);

describe('idPrefixRanges', () => {
  it('lists the exact ID, then each longer ID that extends it', () => {
    expect(idPrefixRanges('45').slice(0, 4)).toEqual([
      [45, 45],
      [450, 459],
      [4500, 4599],
      [45000, 45999],
    ]);
  });

  it('agrees with "the ID starts with these digits" for every ID it is asked about', () => {
    for (const digits of ['1', '7', '10', '45', '299', '4521', '99999']) {
      const ranges = idPrefixRanges(digits);
      const disagreeing: number[] = [];
      for (let id = 1; id <= 320_000; id++) {
        if (inRanges(id, ranges) !== startsWith(id, digits)) disagreeing.push(id);
      }
      expect(disagreeing).toEqual([]);
    }
  });

  it('is ascending and never overlaps, so range order is ID order', () => {
    const ranges = idPrefixRanges('3');
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]![0]).toBeGreaterThan(ranges[i - 1]![1]);
    }
  });

  it('stops at the largest integer the column can hold', () => {
    const ranges = idPrefixRanges('2');
    expect(ranges.at(-1)).toEqual([2_000_000_000, 2_147_483_647]);
    expect(idPrefixRanges('3').at(-1)).toEqual([300_000_000, 399_999_999]);
    expect(idPrefixRanges('2147483647')).toEqual([[2_147_483_647, 2_147_483_647]]);
  });

  it('is empty for what no ID can start with', () => {
    expect(idPrefixRanges('0')).toEqual([]);
    expect(idPrefixRanges('045')).toEqual([]);
    expect(idPrefixRanges('2147483648')).toEqual([]);
    expect(idPrefixRanges('99999999999999999999')).toEqual([]);
    expect(idPrefixRanges('')).toEqual([]);
    expect(idPrefixRanges('12a')).toEqual([]);
    expect(idPrefixRanges('-5')).toEqual([]);
  });
});
