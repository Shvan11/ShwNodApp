/**
 * The default query-retry policy. The client itself is TanStack's; what is ours
 * is the predicate that decides whether a failure is worth another round-trip,
 * and it is the kind of rule that regresses silently (a bare numeric `retry`
 * looks identical at the call site). Pinned here.
 */
import { describe, expect, it } from 'vitest';
import { isExpectedStatus, isTransientQueryError } from './client';
import { archformPatientsQuery } from './queries';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('isTransientQueryError', () => {
  it('retries 5xx', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(isTransientQueryError(httpError(s))).toBe(true);
    }
  });

  it('does NOT retry 4xx — a 404 on a deleted row is the answer, not a blip', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(isTransientQueryError(httpError(s))).toBe(false);
    }
  });

  it('does NOT retry a contract-drift throw (the H11 fail-loud guard)', () => {
    const drift = Object.assign(new Error('Response validation failed for /api/x'), {
      validation: [{ path: ['id'], message: 'expected number' }],
    });
    expect(isTransientQueryError(drift)).toBe(false);
  });

  it('does NOT retry an abort — the caller navigated away', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTransientQueryError(abort)).toBe(false);
  });

  it('retries a status-less failure (network error / our own timeout)', () => {
    expect(isTransientQueryError(new TypeError('Failed to fetch'))).toBe(true);
    const timeout = new Error('Request timed out after 30000ms');
    timeout.name = 'TimeoutError';
    expect(isTransientQueryError(timeout)).toBe(true);
  });

  it('is false for a nullish error rather than throwing', () => {
    expect(isTransientQueryError(undefined)).toBe(false);
    expect(isTransientQueryError(null)).toBe(false);
  });
});

describe('isExpectedStatus', () => {
  it('holds back only the statuses a read declares', () => {
    const meta = { expectedStatuses: [503] };
    expect(isExpectedStatus(httpError(503), meta)).toBe(true);
    expect(isExpectedStatus(httpError(500), meta)).toBe(false);
    expect(isExpectedStatus(new TypeError('Failed to fetch'), meta)).toBe(false);
  });

  it('reports everything from a read that declares nothing', () => {
    expect(isExpectedStatus(httpError(503), undefined)).toBe(false);
    expect(isExpectedStatus(httpError(503), {})).toBe(false);
  });

  it('is what the Archform matcher read declares for its unreachable-file state', () => {
    expect(isExpectedStatus(httpError(503), archformPatientsQuery().meta)).toBe(true);
    expect(isExpectedStatus(httpError(500), archformPatientsQuery().meta)).toBe(false);
  });
});
