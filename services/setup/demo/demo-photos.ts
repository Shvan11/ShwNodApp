/**
 * Puts one demo timepoint's photos where the app's own photo editor would have put them.
 *
 * Mirrors photo-editor.routes.ts#processRenderJob step for step, so a demo timepoint is
 * indistinguishable from one a user saved: the originals go into the patient's timepoint folder
 * (`clinic1/{pid}/{Name}_{DD-MM-YYYY}/`) already carrying the editor's `{view}-` tag, each view is
 * rendered through `renderSlotToWorking` into `working/{pid}{tp:02}.{view}`, and its
 * `time_point_images` row is upserted. The editor can reopen and re-crop them like any others.
 *
 * The pack (data/demo/photos/<timepoint>/<view>.jpg) is already cut to each view's aspect, so the
 * render is an identity crop: the output size is the source's own.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VIEW_CODES } from '../../../shared/photo-views.js';
import { dolphinImageFileName, patientPath, workingDir } from '../../files/clinic-paths.js';
import { timepointFolderName } from '../../imaging/photo-cleanup.service.js';
import { renderSlotToWorking } from '../../imaging/photo-render.service.js';
import {
  findOrCreateNativeTimePoint,
  upsertNativeTimePointImage,
} from '../../database/queries/native-timepoint-queries.js';
import { ymd } from './demo-plan.js';

/** The photo pack, resolved from the working directory like data/templates (receipt-service.ts). */
export function demoPhotoRoot(): string {
  return path.resolve(process.cwd(), 'data', 'demo', 'photos');
}

/** The pack's timepoints in story order. */
export const DEMO_PHOTO_TIMEPOINTS = [
  { dir: '01-initial', name: 'Initial' },
  { dir: '02-progress', name: 'Progress' },
  { dir: '03-progress', name: 'Progress' },
  { dir: '04-final', name: 'Final' },
] as const;

export async function placeDemoTimepoint(
  personId: number,
  tpName: string,
  date: Date,
  packDir: string
): Promise<{ tpCode: number; views: number }> {
  const folder = timepointFolderName(tpName, ymd(date));
  if (!folder) throw new Error(`Cannot name the timepoint folder for "${tpName}" on ${ymd(date)}`);
  await fs.mkdir(patientPath(personId, folder), { recursive: true });
  await fs.mkdir(workingDir(), { recursive: true });

  const { tp_code: tpCode, timePointId } = await findOrCreateNativeTimePoint(personId, tpName, date);
  let views = 0;
  for (const view of VIEW_CODES) {
    const source = path.join(packDir, `${view}.jpg`);
    const original = `${view}-demo-photo.jpg`; // the editor's view tag (shared/photo-views.ts)
    await fs.copyFile(source, patientPath(personId, `${folder}/${original}`));
    const { width, height } = await sharp(source).metadata();
    if (!width || !height) throw new Error(`Unreadable demo photo: ${source}`);
    await renderSlotToWorking({
      personId,
      tpCode,
      view,
      sourceRelPath: `${folder}/${original}`,
      flipH: false,
      flipV: false,
      rotation: 0,
      output: { width, height },
    });
    const digits = view.slice(1);
    await upsertNativeTimePointImage(timePointId, personId, digits, dolphinImageFileName(personId, tpCode, view), date, null);
    views++;
  }
  return { tpCode, views };
}
