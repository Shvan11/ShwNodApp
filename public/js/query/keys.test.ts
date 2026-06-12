/**
 * Tests for the qk query-key factory — the single source of truth for every
 * TanStack Query key (replaces the string keys in the deleted loader-cache).
 * The hierarchy is load-bearing: a parent key must be a prefix of its children
 * so invalidateQueries({ queryKey: parent }) refreshes them all (this is how the
 * cross-domain staleness gaps close).
 */
import { describe, expect, it } from 'vitest';
import { qk } from './keys';

const isPrefix = (parent: readonly unknown[], child: readonly unknown[]): boolean =>
  parent.every((seg, i) => child[i] === seg);

describe('qk query-key factory', () => {
  it('patient.all is a prefix of info/full/works/timepoints', () => {
    const all = qk.patient.all(7);
    expect(isPrefix(all, qk.patient.info(7))).toBe(true);
    expect(isPrefix(all, qk.patient.full(7))).toBe(true);
    expect(isPrefix(all, qk.patient.works(7))).toBe(true);
    expect(isPrefix(all, qk.patient.timepoints(7))).toBe(true);
  });

  it('keeps patient.info and patient.full distinct (different endpoints)', () => {
    expect(qk.patient.info(7)).not.toEqual(qk.patient.full(7));
  });

  it('work.all is a prefix of details/visits/payments', () => {
    const all = qk.work.all(5);
    expect(isPrefix(all, qk.work.details(5))).toBe(true);
    expect(isPrefix(all, qk.work.visits(5))).toBe(true);
    expect(isPrefix(all, qk.work.payments(5))).toBe(true);
  });

  it('templates.all is a prefix of list and one', () => {
    const all = qk.templates.all();
    expect(isPrefix(all, qk.templates.list())).toBe(true);
    expect(isPrefix(all, qk.templates.one(3))).toBe(true);
  });

  it('preserves the legacy wire keys for the SSE-driven screens', () => {
    expect(qk.appointments.daily('2026-06-12')).toEqual(['daily-appointments', '2026-06-12']);
    expect(qk.whatsapp.messages('2026-06-12')).toEqual(['whatsapp-messages', '2026-06-12']);
  });

  it('separates entities by id', () => {
    expect(qk.patient.all(1)).not.toEqual(qk.patient.all(2));
    expect(qk.work.all(1)).not.toEqual(qk.work.all(2));
  });
});
