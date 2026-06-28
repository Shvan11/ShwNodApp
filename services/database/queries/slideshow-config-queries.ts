/**
 * Saved slideshow configurations (`slideshow_configs`, LOCAL-ONLY table).
 *
 * CRUD for the Patient Presentation Slideshow: per-patient saved sequences
 * (`person_id` set, `kind='literal'`) + clinic-wide generic templates
 * (`person_id` NULL, `kind='template'`). See
 * migrations/pg/1782600000000_slideshow-configs.sql.
 *
 * Raw `sql<ConfigRow>` tagged templates (mirroring approval-service) type each
 * result row directly as the contract's `ConfigRow`, so the parsed `config`
 * jsonb + `created_at` timestamp need no manual casts — the contract's
 * `sendData` dev-parse is the runtime guard on the way out.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import type {
  ConfigRow,
  CreateConfigBody,
  UpdateConfigBody,
} from '../../../shared/contracts/slideshow.contract.js';

const COLS = sql`id, person_id, name, kind, config, created_at`;

/** A patient's saved sequences PLUS the clinic-wide generic templates (NULL person). */
export async function listConfigs(personId?: number): Promise<ConfigRow[]> {
  const db = getKysely();
  const ownFilter = personId == null ? sql`` : sql` OR person_id = ${personId}`;
  const res = await sql<ConfigRow>`
    SELECT ${COLS}
    FROM slideshow_configs
    WHERE person_id IS NULL${ownFilter}
    ORDER BY created_at DESC
  `.execute(db);
  return res.rows;
}

export async function getConfigById(id: number): Promise<ConfigRow | null> {
  const db = getKysely();
  const res = await sql<ConfigRow>`SELECT ${COLS} FROM slideshow_configs WHERE id = ${id}`.execute(db);
  return res.rows[0] ?? null;
}

/** Insert a config; `kind` is taken from the payload's discriminant. */
export async function createConfig(input: CreateConfigBody): Promise<ConfigRow> {
  const db = getKysely();
  const res = await sql<ConfigRow>`
    INSERT INTO slideshow_configs (person_id, name, kind, config)
    VALUES (${input.personId}, ${input.name}, ${input.config.kind}, ${JSON.stringify(input.config)}::jsonb)
    RETURNING ${COLS}
  `.execute(db);
  return res.rows[0];
}

/** Update name and/or the saved sequence (kind follows the new config). */
export async function updateConfig(id: number, input: UpdateConfigBody): Promise<ConfigRow | null> {
  const sets = [];
  if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
  if (input.config !== undefined) {
    sets.push(sql`kind = ${input.config.kind}`);
    sets.push(sql`config = ${JSON.stringify(input.config)}::jsonb`);
  }
  if (sets.length === 0) return getConfigById(id); // nothing to change

  const db = getKysely();
  const res = await sql<ConfigRow>`
    UPDATE slideshow_configs
    SET ${sql.join(sets, sql`, `)}
    WHERE id = ${id}
    RETURNING ${COLS}
  `.execute(db);
  return res.rows[0] ?? null;
}

export async function deleteConfig(id: number): Promise<{ id: number } | null> {
  const db = getKysely();
  const res = await sql<{ id: number }>`
    DELETE FROM slideshow_configs WHERE id = ${id} RETURNING id
  `.execute(db);
  return res.rows[0] ?? null;
}
