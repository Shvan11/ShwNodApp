/**
 * Tests for the exported pure helper of the mutation layer. The hook itself
 * (useApiMutation) is a thin wrapper over TanStack's useMutation +
 * queryClient.invalidateQueries (both library-tested); its behaviour is
 * exercised end-to-end in the manual smoke pass. The pure conflict predicate is
 * unit-tested here.
 */
import { describe, expect, it } from 'vitest';
import { isInvalidStateTransition } from './useApiMutation';

describe('isInvalidStateTransition', () => {
  it('is true for a 400 whose details.code is INVALID_STATE_TRANSITION', () => {
    expect(
      isInvalidStateTransition({ status: 400, data: { details: { code: 'INVALID_STATE_TRANSITION' } } })
    ).toBe(true);
  });

  it('is false for a 400 with a different code', () => {
    expect(
      isInvalidStateTransition({ status: 400, data: { details: { code: 'DUPLICATE_PATIENT_NAME' } } })
    ).toBe(false);
  });

  it('is false for the right code but the wrong status', () => {
    expect(
      isInvalidStateTransition({ status: 409, data: { details: { code: 'INVALID_STATE_TRANSITION' } } })
    ).toBe(false);
  });

  it('is false for missing or odd shapes', () => {
    expect(isInvalidStateTransition(undefined)).toBe(false);
    expect(isInvalidStateTransition(null)).toBe(false);
    expect(isInvalidStateTransition({})).toBe(false);
    expect(isInvalidStateTransition({ status: 400 })).toBe(false);
    expect(isInvalidStateTransition({ status: 400, data: {} })).toBe(false);
    expect(isInvalidStateTransition(new Error('boom'))).toBe(false);
  });
});
