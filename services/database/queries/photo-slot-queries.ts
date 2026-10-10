/**
 * Photo slot names — `image_types`, Dolphin's slot-code dictionary, with the clinic's own name
 * for each slot outside the 8 grid views (`label`; Settings → Lookups → Photo Slot Names).
 *
 * The table outlives Dolphin as the record of what each legacy `.Inn` code means
 * (docs/photo-sessions.md, "Dolphin's other slots"). The grid views are never listed or renamed
 * here: their names are the app's own (`shared/photo-views.ts`).
 */
import { getKysely } from '../kysely.js';
import { VIEW_CODES } from '../../../shared/photo-views.js';

/** The grid views' codes as `image_types` spells them ('10', '12', …). */
const GRID_CODES: string[] = VIEW_CODES.map((v) => v.slice(1));

export type PhotoSlotRow = {
  code: string;
  dolphinName: string | null;
  label: string | null;
  images: number;
};

/** Every slot outside the grid views (or just `code`), with its names and how many photo records use it. */
export async function listPhotoSlots(code?: string): Promise<PhotoSlotRow[]> {
  let query = getKysely()
    .selectFrom('image_types as t')
    .leftJoin(
      (eb) =>
        eb
          .selectFrom('time_point_images')
          .select((e) => ['image_type', e.fn.countAll<number>().as('n')])
          .groupBy('image_type')
          .as('c'),
      (join) => join.onRef('c.image_type', '=', 't.image_type_code')
    )
    .select(['t.image_type_code as code', 't.description as dolphinName', 't.label as label', 'c.n as images'])
    .where('t.image_type_code', 'not in', GRID_CODES)
    .orderBy('t.image_type_code');
  if (code !== undefined) query = query.where('t.image_type_code', '=', code);
  const rows = await query.execute();
  return rows.map((r) => ({
    code: r.code.trim(),
    dolphinName: r.dolphinName,
    label: r.label,
    images: Number(r.images ?? 0),
  }));
}

/**
 * Set the clinic's name for a slot, or clear it (`null`). Returns the slot as saved, or null
 * when `code` names no renameable slot (unknown, or a grid view).
 */
export async function setPhotoSlotLabel(code: string, label: string | null): Promise<PhotoSlotRow | null> {
  if (GRID_CODES.includes(code)) return null;
  const updated = await getKysely()
    .updateTable('image_types')
    .set({ label })
    .where('image_type_code', '=', code)
    .returning('image_type_code')
    .executeTakeFirst();
  if (!updated) return null;
  const [slot] = await listPhotoSlots(code);
  return slot ?? null;
}

/** The clinic's names, keyed like the working-files listing's `view`: 'i02' → 'Smile close-up'. */
export async function getPhotoSlotLabels(): Promise<Map<string, string>> {
  const rows = await getKysely()
    .selectFrom('image_types')
    .select(['image_type_code', 'label'])
    .where('label', 'is not', null)
    .where('image_type_code', 'not in', GRID_CODES)
    .execute();
  const names = new Map<string, string>();
  for (const r of rows) if (r.label) names.set(`i${r.image_type_code.trim()}`, r.label);
  return names;
}
