/**
 * Remake direction guard — a pure rule over LAB_STAGES, no DB and no config.
 *
 * It lives apart from `lab-case-service.ts` so the unit tests can reach it without
 * importing that service's module graph, which pulls in `services/database/kysely.js`
 * → `config/config.js` and throws at import time when the boot env is absent (CI has
 * no `.env`).
 */
import { LAB_STAGES, type LabStage } from '../../shared/contracts/lab-case.contract.js';

/**
 * Assert that a remake sends the case BACKWARD.
 *
 * That is the whole meaning of the operation, and `advanceLabCase` enforces the
 * mirror rule for forward moves. This used to check only membership in
 * LAB_STAGES, so a client-supplied `returnToStatus` could jump a case FORWARD —
 * as far as 'delivered', setting the terminal status with no `delivered_at` /
 * `delivered_by` — while incrementing `remake_count`.
 */
export function assertRemakeTarget(fromStatus: string, toStatus: string): void {
  const toIdx = LAB_STAGES.indexOf(toStatus as LabStage);
  if (toIdx === -1) {
    throw new Error('[INVALID_STATE_TRANSITION] Invalid returnToStatus');
  }
  const fromIdx = LAB_STAGES.indexOf(fromStatus as LabStage);
  if (fromIdx === -1 || toIdx >= fromIdx) {
    throw new Error('[INVALID_STATE_TRANSITION] returnToStatus must be an earlier stage than the current one');
  }
}
