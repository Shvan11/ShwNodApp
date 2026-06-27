/**
 * Dental shade lookups.
 *
 * Two industry-standard shade systems, each stored in its own physical table
 * (`shade_vita_classic`, `shade_3d_master` — the user's chosen "one table per
 * system" design). `getShades()` reads both and assembles a single grouped
 * payload for the work-item dependent dropdown (pick a system → its shades).
 *
 * The system *labels* are hard-coded here: with two separate tables there is no
 * `shade_systems` table to read them from. This is the one accepted trade-off of
 * the one-table-per-system model — adding a third system means a new table + a new
 * entry here.
 */
import { getKysely } from '../kysely.js';

type ShadeRow = { id: number; shade: string };
// `type` (not interface) so the result is assignable to the contract's closed
// z.object response when passed to `sendData` (the looseObject index-signature rule
// in docs/shared-contract-progress.md — applies to any sendData data source).
type ShadeSystem = { name: string; shades: ShadeRow[] };
type ShadesResult = { systems: ShadeSystem[] };

export async function getShades(): Promise<ShadesResult> {
  const db = getKysely();
  const [vitaClassic, threeDMaster] = await Promise.all([
    db.selectFrom('shade_vita_classic').select(['id', 'shade']).orderBy('id').execute(),
    db.selectFrom('shade_3d_master').select(['id', 'shade']).orderBy('id').execute(),
  ]);
  return {
    systems: [
      { name: 'Vita Classic', shades: vitaClassic },
      { name: '3D Master', shades: threeDMaster },
    ],
  };
}
