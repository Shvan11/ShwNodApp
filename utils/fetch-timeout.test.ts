/**
 * Tests for the outbound-fetch timeout helpers.
 *
 * node-fetch v3 dropped its `timeout` option, so the 3Shape and WebCeph clients had no upper bound
 * on a call. The distinction that matters: a REFUSED connection fails in milliseconds, but a
 * DROPPED packet (workstation asleep / firewalled) hangs past Express's own 30s cap, so the caller
 * never saw the actionable "is Unite running?" message these clients work to produce.
 */
import { describe, expect, it } from 'vitest';
import { describeFetchError, isAbortError } from './fetch-timeout.js';

/** DOMException-style errors are discriminated by `name`, not by message. */
const named = (name: string): Error => Object.assign(new Error('aborted'), { name });

describe('isAbortError', () => {
  it('recognises an AbortSignal.timeout rejection', () => {
    expect(isAbortError(named('TimeoutError'))).toBe(true);
  });

  it('recognises a caller-initiated abort', () => {
    expect(isAbortError(named('AbortError'))).toBe(true);
  });

  it('does not fire on an ordinary network error', () => {
    expect(isAbortError(Object.assign(new Error('connect ECONNREFUSED'), { name: 'FetchError' }))).toBe(false);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('tolerates non-Error values', () => {
    expect(isAbortError('TimeoutError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('describeFetchError', () => {
  it('renders a timeout in seconds rather than as a raw exception', () => {
    expect(describeFetchError(named('TimeoutError'), 15_000)).toBe('no response within 15s');
  });

  it('rounds sub-second and fractional budgets sensibly', () => {
    expect(describeFetchError(named('TimeoutError'), 120_000)).toBe('no response within 120s');
    expect(describeFetchError(named('AbortError'), 2_500)).toBe('no response within 3s');
  });

  it('passes a real network error through unchanged', () => {
    expect(describeFetchError(new Error('connect ECONNREFUSED 10.0.0.5:5492'), 15_000)).toBe(
      'connect ECONNREFUSED 10.0.0.5:5492'
    );
  });

  it('stringifies a non-Error throw', () => {
    expect(describeFetchError('weird', 15_000)).toBe('weird');
  });
});
