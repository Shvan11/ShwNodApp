-- Up Migration
--
-- Promote seven application-level invariants into database constraints.
--
-- All seven columns were nullable only as residue of the SQL-Server-era conversion
-- (the five `visits` flags carry `DEFAULT false` WITHOUT `NOT NULL` — a default fires
-- only when the column is OMITTED, so an explicit NULL always slipped through). No
-- writer produces a NULL in any of them: the three insert sites
-- (visit-queries.ts#addVisit / #addVisitByWorkId, native-timepoint-queries.ts) each
-- either supply a value or omit the column and let the default fire. Verified 0 NULLs
-- in all seven columns on both the local DB and the Supabase mirror before applying.
--
-- Why constrain rather than keep coalescing on read: NULL means "unknown", not `false`
-- / "no date". The read paths were defaulting NULL away in SQL, which MASKS a violation
-- instead of surfacing it — a NULL date rendered as `Invalid Date`, made that timepoint
-- un-editable in the photo editor (its render endpoint requires a YYYY-MM-DD `tpDate`),
-- and made a scope=all delete silently skip the originals folder. Three-valued logic is
-- the other cost: `WHERE NOT opg` and `count(*) FILTER (WHERE opg)` both drop NULL rows,
-- so any future "visits without an OPG" report would have under-counted silently.
--
-- The `DEFAULT false` on the five flags is deliberately RETAINED — visit-queries.ts#addVisit
-- omits all five on insert and relies on it. NOT NULL + DEFAULT is the pairing we want.
--
-- Small tables (visits ~35K, time_points ~3.5K), so the ACCESS EXCLUSIVE lock and the
-- validation scan are milliseconds; no CHECK ... NOT VALID / VALIDATE split needed.
-- A pre-existing NULL would abort the whole migration cleanly (single transaction).

ALTER TABLE visits
  ALTER COLUMN opg               SET NOT NULL,
  ALTER COLUMN p_photo           SET NOT NULL,
  ALTER COLUMN i_photo           SET NOT NULL,
  ALTER COLUMN f_photo           SET NOT NULL,
  ALTER COLUMN appliance_removed SET NOT NULL;

ALTER TABLE time_points
  ALTER COLUMN tp_date_time   SET NOT NULL,
  ALTER COLUMN tp_description SET NOT NULL;

-- Down Migration
--
-- Reverting only re-widens the columns; it does NOT restore the read-side coalesce that
-- this change removed (timepoint-queries.ts / visit-queries.ts). After a down, a NULL in
-- any of these would reach the wire contract and throw on the client — which is the
-- intended fail-loud behaviour, but worth knowing before reverting.

ALTER TABLE visits
  ALTER COLUMN opg               DROP NOT NULL,
  ALTER COLUMN p_photo           DROP NOT NULL,
  ALTER COLUMN i_photo           DROP NOT NULL,
  ALTER COLUMN f_photo           DROP NOT NULL,
  ALTER COLUMN appliance_removed DROP NOT NULL;

ALTER TABLE time_points
  ALTER COLUMN tp_date_time   DROP NOT NULL,
  ALTER COLUMN tp_description DROP NOT NULL;
