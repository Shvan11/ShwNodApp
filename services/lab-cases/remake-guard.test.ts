/**
 * Tests for the remake direction guard.
 *
 * A remake returns a case to an EARLIER stage. The guard used to check only that
 * `returnToStatus` was a member of LAB_STAGES, so a crafted request could remake
 * a case FORWARD — including straight to 'delivered', which set the terminal
 * status while leaving delivered_at/delivered_by null and bumping remake_count.
 */
import { describe, expect, it } from 'vitest';
import { LAB_STAGES } from '../../shared/contracts/lab-case.contract.js';
import { assertRemakeTarget } from './lab-case-service.js';

const BACKWARD = /earlier stage/;
const INVALID = /Invalid returnToStatus/;

describe('assertRemakeTarget', () => {
  it('allows a move to any earlier stage', () => {
    expect(() => assertRemakeTarget('ceramic_buildup', 'framework_fab')).not.toThrow();
    expect(() => assertRemakeTarget('delivered', 'sent_to_lab')).not.toThrow();
    expect(() => assertRemakeTarget('ready', 'glaze')).not.toThrow();
  });

  it('rejects a move FORWARD — the bug', () => {
    expect(() => assertRemakeTarget('sent_to_lab', 'delivered')).toThrow(BACKWARD);
    expect(() => assertRemakeTarget('wax_up_tryin', 'ready')).toThrow(BACKWARD);
    expect(() => assertRemakeTarget('glaze', 'delivered')).toThrow(BACKWARD);
  });

  it('rejects a no-op move to the same stage', () => {
    expect(() => assertRemakeTarget('glaze', 'glaze')).toThrow(BACKWARD);
  });

  it('rejects a target outside the stage list', () => {
    expect(() => assertRemakeTarget('glaze', 'cancelled')).toThrow(INVALID);
    expect(() => assertRemakeTarget('glaze', 'not_a_stage')).toThrow(INVALID);
  });

  it('rejects an unknown current stage (e.g. a cancelled case)', () => {
    expect(() => assertRemakeTarget('cancelled', 'sent_to_lab')).toThrow(BACKWARD);
  });

  it('never lets the first stage remake anywhere', () => {
    for (const target of LAB_STAGES) {
      expect(() => assertRemakeTarget(LAB_STAGES[0], target)).toThrow();
    }
  });

  it('holds for every ordered pair in LAB_STAGES', () => {
    // Exhaustive: strictly-earlier passes, everything else throws.
    LAB_STAGES.forEach((from, i) => {
      LAB_STAGES.forEach((to, j) => {
        if (j < i) expect(() => assertRemakeTarget(from, to)).not.toThrow();
        else expect(() => assertRemakeTarget(from, to)).toThrow(BACKWARD);
      });
    });
  });
});
