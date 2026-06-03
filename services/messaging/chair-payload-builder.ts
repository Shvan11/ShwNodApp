// services/messaging/chair-payload-builder.ts
//
// Builds the payload sent to a chair-display kiosk when staff loads a patient.
// Transport-agnostic: returns just the payload object. The caller decides
// whether to cache it, broadcast it over WS, push it over SSE, or all three.

import { getTimePointImgs } from '../database/queries/timepoint-queries.js';
import { getLatestVisitsSum } from '../database/queries/visit-queries.js';
import { getActiveWork } from '../database/queries/work-queries.js';
import { getPatientById } from '../database/queries/patient-queries.js';
import { log } from '../../utils/logger.js';

// Mirror of public/js/config/workTypeConfig.ts ORTHO_WORK_TYPES — visit notes
// only show for active orthodontic work on the chair-side display.
const ORTHO_WORK_TYPE_IDS: ReadonlySet<number> = new Set([1, 2, 11, 19, 20]);
const CHAIR_DISPLAY_INTRAORAL_EXTS = ['.i20', '.i22', '.i21'] as const;

export interface ChairPatientPayload {
  pid: string;
  name: string | null;
  images: Array<{ name: string }>;
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
    const allImages = await getPatientImagesLocal(pid);
    const filteredImages = allImages.filter(img =>
      CHAIR_DISPLAY_INTRAORAL_EXTS.some(ext => img.name.toLowerCase().endsWith(ext))
    );
    filteredImages.sort((a, b) => {
      const aExt = CHAIR_DISPLAY_INTRAORAL_EXTS.find(ext => a.name.toLowerCase().endsWith(ext)) || '';
      const bExt = CHAIR_DISPLAY_INTRAORAL_EXTS.find(ext => b.name.toLowerCase().endsWith(ext)) || '';
      return CHAIR_DISPLAY_INTRAORAL_EXTS.indexOf(aExt as typeof CHAIR_DISPLAY_INTRAORAL_EXTS[number])
        - CHAIR_DISPLAY_INTRAORAL_EXTS.indexOf(bExt as typeof CHAIR_DISPLAY_INTRAORAL_EXTS[number]);
    });

    const activeWork = await getActiveWork(personId);
    const isOrtho = !!(activeWork && ORTHO_WORK_TYPE_IDS.has(activeWork.type_of_work as number));
    const [latestVisit, patientRecord] = await Promise.all([
      isOrtho ? getLatestVisitsSum(personId) : Promise.resolve(null),
      getPatientById(personId),
    ]);

    const name = patientRecord?.patient_name?.trim() ||
      [patientRecord?.first_name, patientRecord?.last_name].filter(Boolean).join(' ').trim() ||
      null;

    return {
      pid,
      name,
      images: filteredImages,
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

async function getPatientImagesLocal(pid: string): Promise<Array<{ name: string }>> {
  try {
    const tp = '0';
    const images = await getTimePointImgs(pid, tp);
    return images.map((code: string | number) => ({ name: `${pid}0${tp}.i${code}` }));
  } catch (error) {
    log.error('Error getting patient images', error as Error);
    return [];
  }
}
