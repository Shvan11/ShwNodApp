// services/messaging/chair-payload-builder.ts
//
// Builds the payload sent to a chair-display kiosk when staff loads a patient.
// Transport-agnostic: returns just the payload object. The caller decides
// whether to cache it, broadcast it over WS, push it over SSE, or all three.

import { getImageSizes } from '../imaging/index.js';
import { getLatestVisitsSum } from '../database/queries/visit-queries.js';
import { getActiveWork } from '../database/queries/work-queries.js';
import { getPatientById } from '../database/queries/patient-queries.js';
import { ORTHO_WORK_TYPE_IDS } from '../../shared/treatment-taxonomy.js';
import { log } from '../../utils/logger.js';

// Visit notes only show for active orthodontic work on the chair-side display.
const ORTHO_WORK_TYPE_SET: ReadonlySet<number> = new Set(ORTHO_WORK_TYPE_IDS);
// Right, centre, left — in the kiosk's display order.
const CHAIR_DISPLAY_INTRAORAL_VIEWS = ['i20', 'i22', 'i21'] as const;

export interface ChairPatientPayload {
  pid: string;
  name: string | null;
  /** `name` is the file actually on disk (either case); `v` its mtime, the URL's
   *  cache-bust token — the photos are served as immutable (FE-F13-1's siblings). */
  images: Array<{ name: string; v: number }>;
  latestVisit: { visit_date?: string; Summary?: string | null } | null | undefined;
}

/**
 * Build the chair-display payload for a patient. Returns null if the personId
 * is invalid; any DB error is logged and surfaces as null (caller treats null
 * as "do nothing"). Same query set as the legacy WS handler so behavior is
 * identical between transports during the SSE migration.
 */
export async function buildChairPatientPayload(
  pid: string,
  chairId: string,
): Promise<ChairPatientPayload | null> {
  const personId = parseInt(pid, 10);
  if (!Number.isFinite(personId) || personId <= 0) {
    log.warn('Invalid personId for chair-display load', { pid });
    return null;
  }

  try {
    // Independent reads — the kiosk waits on the slowest, not on their sum. Only
    // the visit summary has to follow (it's gated on the work being orthodontic).
    const [initialPhotos, activeWork, patientRecord] = await Promise.all([
      getPatientImagesLocal(pid),
      getActiveWork(personId),
      getPatientById(personId),
    ]);

    const isOrtho = !!(activeWork && ORTHO_WORK_TYPE_SET.has(activeWork.type_of_work as number));
    const latestVisit = isOrtho ? await getLatestVisitsSum(personId) : null;

    const name = patientRecord?.patient_name?.trim() ||
      [patientRecord?.first_name, patientRecord?.last_name].filter(Boolean).join(' ').trim() ||
      null;

    return {
      pid,
      name,
      images: initialPhotos,
      latestVisit,
    };
  } catch (error) {
    log.error('Error building chair-display payload', {
      error: (error as Error).message,
      pid,
      chairId,
    });
    return null;
  }
}

/**
 * The first session's intraoral photos, from the FILES (the gallery's probe: either
 * case on disk, with the mtime) — not rebuilt from `time_point_images` rows, which can
 * name a file that is gone or miss one that exists (FE-F13-8's shape).
 */
async function getPatientImagesLocal(pid: string): Promise<Array<{ name: string; v: number }>> {
  try {
    const gallery = await getImageSizes(pid, '0');
    return CHAIR_DISPLAY_INTRAORAL_VIEWS.flatMap((view) => {
      const img = gallery[view];
      return img ? [{ name: img.name, v: img.mtime }] : [];
    });
  } catch (error) {
    log.error('Error getting patient images', error as Error);
    return [];
  }
}
