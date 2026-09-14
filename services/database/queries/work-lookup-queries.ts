/**
 * Work LOOKUP queries — the four reference tables a work / work-item form reads
 * its dropdowns from: `work_types`, `keywords`, `implant_manufacturers`, `labs`.
 *
 * Split out of work-queries.ts: these are read-only catalogue reads with no
 * dependency on a work row, and two of them (implant manufacturers, labs) are
 * served by lookup.routes.ts rather than work.routes.ts.
 */
import { getKysely } from '../kysely.js';

type work_type = {
  id: number;
  work_type: string;
};

// `keywords.key_word` is nullable in the schema and work.contract.ts#getWorkKeywords
// models it nullable (the dropdown renders it directly).
type Keyword = {
  id: number;
  key_word: string | null;
};

// `type` (not `interface`) so an ImplantManufacturer[] is assignable to the
// lookup contract's `z.array(z.looseObject({ id }))` sendData arg (the index-
// signature rule — docs/shared-contract-progress.md).
type ImplantManufacturer = {
  id: number;
  name: string;
};

// `type` (not `interface`) so a Lab[] is assignable to the lookup contract's
// `z.array(z.looseObject({ id }))` sendData arg (the index-signature rule).
type Lab = { id: number; name: string };

export async function getWorkTypes(): Promise<work_type[]> {
  const db = getKysely();
  return db
    .selectFrom('work_types')
    .select(['id', 'work_type'])
    .orderBy('work_type')
    .execute();
}

export async function getWorkKeywords(): Promise<Keyword[]> {
  const db = getKysely();
  return db
    .selectFrom('keywords')
    .select(['id', 'key_word'])
    .orderBy('key_word')
    .execute();
}

export async function getImplantManufacturers(): Promise<ImplantManufacturer[]> {
  const db = getKysely();
  return db
    .selectFrom('implant_manufacturers')
    .select(['id as id', 'manufacturer_name as name'])
    .orderBy('manufacturer_name')
    .execute();
}

/**
 * Active labs for the Bridge/Veneers work-item dropdown — the first-class `labs`
 * table (managed in Settings → Lookups → Labs). Returned as `{ id, name }` like
 * getImplantManufacturers; `work_items.lab_id` is a real FK to labs, so a lab in use
 * can't be hard-deleted — it's retired via `is_active=false` and hidden here.
 */
export async function getLabs(): Promise<Lab[]> {
  const db = getKysely();
  return db
    .selectFrom('labs')
    .select(['id', 'lab_name as name'])
    .where('is_active', '=', true)
    .orderBy('lab_name')
    .execute();
}
