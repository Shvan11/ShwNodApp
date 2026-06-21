# Photo Sessions & Timepoints

How the app captures, stores, and serves a patient's orthodontic photo sets, plus
the manual recovery runbook for repairing an orphaned timepoint by hand.

The photo flow is **fully self-contained** — it no longer depends on the Dolphin
Imaging desktop software or its `DolphinPlatform` SQL Server database. All timepoint
data lives in the app's own **PostgreSQL** database (`shwan`), in lowercase
`snake_case` tables. (Historical note + the one remaining, unrelated Dolphin touch
point are in [§6](#6-history--the-decommissioned-dolphin-dependency).)

---

## 1. Data model — local, person_id-keyed

Everything lives in PostgreSQL (`shwan`), keyed by `person_id`. `types/db.d.ts`
(from `npm run db:codegen`) is the SSoT for table/column names.

| Table | Purpose |
|-------|---------|
| `time_points` | One row per photo session — `tp_code` (sequential per patient, the authoritative handle), `tp_description` (`Initial`/`Progress`/`Final`/`Retention`), `tp_date_time` (a `date`, wall-clock). |
| `time_point_images` | One row per view image — `image_type` (2-digit view code, e.g. `10`/`22`), `image_file`, `image_date`. FK → `time_points` (`ON DELETE CASCADE`). Unique on `(time_point_id, image_type)`. |
| `image_types` | Code→label dictionary (e.g. `10`=Facial Right, `22`=IntraOral Center, `51`=X-ray Panoramic). Reference only; not FK-enforced. |

> **Date gotcha:** `tp_date_time` is a PG `date` (WITHOUT time zone). The centralized
> `pg` parser (see `services/database/kysely.ts`) already returns `date` columns as a
> `'YYYY-MM-DD'` **string** — don't `$castTo<Date>()` it or `.toISOString()` it, and
> bind `date` params as `'YYYY-MM-DD'` via `toDateOnly()` (using `sql<string>`, never
> `sql<Date>`). A `timestamptz`/UTC round-trip would shift midnight back a day. See
> the Database "Gotchas" in `CLAUDE.md`.

`tp_code` is allocated `MAX(tp_code)+1` per patient inside a `withPgTransaction`
(`findOrCreateNativeTimePoint`): the existing-row lookup takes `SELECT … FOR UPDATE`
so a concurrent identical prepare waits, and the unique `(person_id, tp_code)` index
backstops the new-allocation race (a losing allocator surfaces a unique-violation the
caller can retry). The photo editor is the sole allocator, so the flat `working/`
namespace keyed by `(person_id, tp_code, view)` can't collide.

---

## 2. Capture flow

```
Navigation / ViewPatientInfo
        │  "Photo Layout" / "Add Photos"
        ▼
 PhotoSessionDialog  ── GET  /api/photo-editor/:id/photo-dates  (appointment/visit date hints)
        │             ── POST /api/photo-editor/:id/prepare      (find/create timepoint;
        │                                                         Initial/Final mirror into
        │                                                         tblwork i_photo_date/f_photo_date
        │                                                         with conflict/override)
        ▼  onPrepared → navigate
 /patient/:id/photo-editor/tp{tpCode}   (PhotoEditor)
        │  drag originals into the 8 view slots, frame each
        │  (react-easy-crop: zoom/pan/rotate/crop + flip/mirror)
        ▼  Save
   POST /api/photo-editor/:id/render   → 202 (queued) + SSE on completion
```

**Render (server, sharp):** `/render` resolves the timepoint synchronously, answers
**202** immediately, then renders each framed slot **in the background** (heavy
full-res sharp encodes of up to 8 ~15 MP views would otherwise peg the request and
risk the 30 s timeout). Per slot: `autoOrient → flip/flop → rotate → extract →
resize → jpeg`, written atomically to `working/{personId}0{tpCode}.i{viewCode}`,
plus a row upserted into `time_point_images`. On completion the route emits
`PHOTO_TIMEPOINT_RENDERED` over SSE so the open photo grid refetches (the SSE key is
`tpCode`, camelCase — see the note in `photo-editor.routes.ts`). See
`services/imaging/photo-render.service.ts`.

> **Prepare guards (`POST /:id/prepare`):** the three normal outcomes ride the
> success envelope as a discriminated result — `{ tp_code }` (prepared),
> `{ conflict: true, … }` (an existing tblwork Initial/Final date differs → needs
> `overrideDate`), or `{ needsName: true, … }` (the patient has no English/Latin name;
> the legacy Dolphin SQL Server columns the dolphin sink still feeds are Latin1 and
> corrupt Arabic to `?`, so the user is sent to Edit Patient to add one). These are
> HTTP 200 results, not errors.

**Getting originals onto the share:** photos are uploaded per-patient via the file
explorer (`POST /api/patients/:id/files/upload`, or copied to the LAN share) into a
`{tp_description}_{DD-MM-YYYY}` folder; the editor's sidebar lists them via
`GET /api/patients/:id/files`. No external importer is involved. When the editor
renders a slot it renames the chosen source original in-place to carry a `{view}-`
prefix (e.g. `i12-IMG_001.jpg`) so reopening the slot re-hydrates its source for
re-editing (`shared/photo-views.ts` + `services/imaging/photo-original-tags.ts`).

---

## 3. Reads & serving

- **Timepoint tabs / lists** — `getTimePoints()` / `getTimePointImgs()`
  (`services/database/queries/timepoint-queries.ts`) read the local tables. Used by
  the staff grid, Navigation, Compare, slideshow, the patient portal
  (`routes/portal.ts`), and the chair display.
- **View images** — served at **`/DolImgs/{personId}0{tpCode}.i{viewCode}`**
  (`express.static(workingDir())` in `index.ts`; the `/DolImgs` mount name is
  historical). `getImageSizes()` (`services/imaging/index.ts`) probes the 8 fixed
  filenames on disk — no DB lookup — and returns each view's pixel size plus an
  `mtime` cache-bust token (an edited slot re-renders to the SAME filename, so the
  gallery appends `?v={mtime}` to dodge the browser cache).
- **"Has final photos" patient filter** — `patient.routes.ts` runs an `EXISTS`
  against `time_points`.

### The 8 standard view codes (grid layout)

The filename prefix is `{personId}0{tpCode}` (e.g. patient 4073, tpCode 0 →
`407300`). The **working** file uses lowercase `.i{view}`; the DB `image_file`
uses uppercase `.I{type}` (the view code minus the leading `i`).

| Grid pos | Working file (`i` lower) | DB `image_type` | DB `image_file` (`I` upper) | `image_types.description` | How to identify |
| --- | --- | --- | --- | --- | --- |
| top-L | `…​.i10` | `10` | `…​.I10` | Facial Right | Side **profile** of the face |
| top-M | `…​.i12` | `12` | `…​.I12` | Facial Front | Frontal face, **lips at rest** (mouth closed) |
| top-R | `…​.i13` | `13` | `…​.I13` | Facial Front/Smile | Frontal face, **smiling**, teeth showing |
| mid-L | `…​.i23` | `23` | `…​.I23` | IntraOral UpperOcc | **Upper occlusal** — palate/rugae visible |
| mid-R | `…​.i24` | `24` | `…​.I24` | IntraOral LowerOcc | **Lower occlusal** — tongue/floor of mouth visible |
| bot-L | `…​.i20` | `20` | `…​.I20` | IntraOral Right | Buccal: **incisors on photo RIGHT**, molars left |
| bot-M | `…​.i22` | `22` | `…​.I22` | IntraOral Center | Front teeth in occlusion, retractors |
| bot-R | `…​.i21` | `21` | `…​.I21` | IntraOral Left | Buccal: **incisors on photo LEFT**, molars right |

`VIEW_CODES` in `shared/photo-views.ts` is the SSoT for the set + client/grid order
(`['i10','i12','i13','i23','i24','i20','i22','i21']`). The grid lays these 8 out 3×3
around `logo.png` in the centre (a client-only layout concern; `getImageSizes` never
returns the logo). The full set of codes the data may contain is in `image_types`.

---

## 4. Related paths & files

| Concern | Location |
|---------|----------|
| Timepoint reads (local tables) | `services/database/queries/timepoint-queries.ts` |
| Timepoint/image writes (find-or-create, upsert, update, delete) | `services/database/queries/native-timepoint-queries.ts` |
| Photo-session prep helpers (patient, dates, tblwork conflict) | `services/database/queries/photo-session-queries.ts` |
| Prepare / render / photo-dates / delete-view endpoints | `routes/api/photo-editor.routes.ts` |
| Server-side sharp render | `services/imaging/photo-render.service.ts` |
| View-image sizing + `/DolImgs` static mount | `services/imaging/index.ts`, `index.ts` |
| View codes + original-tag convention (shared SSoT) | `shared/photo-views.ts` |
| Editor UI | `public/js/components/react/photo-editor/`, `PhotoSessionDialog.tsx` |
| Endpoint contracts | `shared/contracts/photo-editor.contract.ts` |

X-rays are a separate flow: under `clinic1/{personId}/OPG/` (CS Imaging metadata in
`.csi_data/.version_4.4/`), converted to PNG via `cs_export` (`processXrayImage` in
`services/imaging/index.ts`) — unchanged by this work.

---

## 5. Manual photo-slot placement runbook

How to take a folder of raw clinical photos for one timepoint and wire them into the
app **by hand** — classify each photo into its view slot, place the rendered file in
`working/`, and insert the matching `time_point_images` rows — so the timepoint's
photo grid lights up exactly as if it had been processed through the native Photo
Editor.

This is the recovery path for **orphaned timepoints**: a `time_points` row whose
source photos exist on disk (in `clinic1/{pid}/{name}_{DD-MM-YYYY}/`) but which has
**0 `time_point_images` rows and no `working/` render files** — so the grid shows an
empty tab. (First encountered 2026-06-12, patient 4073, tp 2332.)

> Prefer the real Photo Editor UI when a human is available — it crops, previews, and
> applies the transforms interactively. This runbook is for bulk/headless repair where
> driving the UI per-photo isn't practical.

### 5a. The three transforms that bite — replicate the editor's defaults

Placing a photo "correctly" is **not** a raw copy for every view. The native editor
applies per-view defaults; a manual placement must reproduce them or the grid looks
wrong. No cropping is needed (and the clinic asked for none), but **orientation and
mirror-flip are mandatory**:

1. **Facial photos carry EXIF orientation.** Portrait facials are often stored as
   landscape pixels + an EXIF orientation tag (we saw `orientation = 8`). Browsers
   honour EXIF and show them upright, but `getImageSizes` (the `image-size` lib) does
   **not** apply EXIF, so it reports landscape dims and the grid slot distorts. →
   **Bake the rotation** with `sharp().autoOrient()` so the stored pixels are upright
   and `orientation` becomes `1`/undefined. (No-op for photos already at
   `orientation = 1`.)

2. **Occlusal views are mirror-shot → vertical flip.** `defaultFlipV()`
   (`photo-editor/photoEditorTypes.ts`) returns `true` for `i23`/`i24` only.
   Upper/lower occlusals are taken through an intraoral mirror, so they arrive
   mirror-reversed and must be flipped **vertically** (`sharp().flip()` = top↔bottom;
   **not** `.flop()`). `flipH` stays `false`. After the flip: upper occlusal →
   incisors at top; lower occlusal → incisors at bottom. **This is easy to forget** —
   it was the one miss on the first run.

3. **Everything else (the 5 non-occlusal intraorals + already-upright facials)** is a
   lossless straight copy — no re-encode, no crop.

Match the editor's JPEG settings when you do re-encode (bake/flip):
`{ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }` (from
`photo-render.service.ts`).

#### Left vs Right buccal — the dangerous one. Get it right.

Buccal laterals (`i20` Right, `i21` Left) are **direct, non-mirror** retracted shots.
The deterministic rule for a direct upright shot:

> **Incisors on the photo's RIGHT ⇒ patient's RIGHT side ⇒ `i20`.**
> **Incisors on the photo's LEFT ⇒ patient's LEFT side ⇒ `i21`.**

Two independent confirmations of this (it is counter-intuitive — a first guess often
inverts it):

- **Vector geometry.** Camera on the patient's right, optical axis pointing medially
  (`-x̂`), up `+ẑ`. Image-right `= forward × up = (-x̂) × ẑ = +ŷ` = patient anterior.
  So anterior/incisors land on the **right** of a right-buccal photo.
- **The app's composite layout.** Right (`i20`) sits bottom-**left** of the grid, Left
  (`i21`) bottom-**right** — i.e. arranged as if facing the patient. Each lateral's
  anterior points **toward the centre** slot, so the right-lateral (left of centre)
  has its incisors on its **right** edge.

If unsure, cross-check a **mirror-invariant unilateral landmark** (an amalgam,
uniquely rotated/peg tooth, a band) against the **frontal** photo (`i22`), which is
unambiguous: in a direct frontal, the **patient's right side is on the image's left**
(they face the camera). A vertical flip does **not** swap left↔right; only a
horizontal flip would — so occlusal flipping can't fix a buccal L/R error.

### 5b. Procedure

**Environment (Windows-native dev/prod, see CLAUDE.md):**
- `psql.exe`: `C:\Program Files\PostgreSQL\18\bin\psql.exe`; connect with `-h localhost`.
- App role: user `shwan_app`, db `shwan` — see `.env` `DATABASE_URL` / `PG_*`.
- `C:\clinic1` is local NTFS; do disk work with `node` (sharp is a project dep) or PowerShell.

**1. Find orphaned timepoints (zero image rows):**

```sql
SELECT tp.time_point_id, tp.person_id, tp.tp_code,
       tp.tp_description, to_char(tp.tp_date_time::date,'DD-MM-YYYY') AS folder_date
FROM time_points tp
WHERE NOT EXISTS (SELECT 1 FROM time_point_images i
                  WHERE i.time_point_id = tp.time_point_id)
ORDER BY tp.person_id, tp.tp_code;
```

For each, the expected originals folder is
`C:\clinic1\{person_id}\{tp_description}_{folder_date}`. **A "fuzzy" folder whose date
is off by a day is usually the real one** (record date vs. photo-session date); a
same-name folder at a *different* date/year usually belongs to a **different**
timepoint (verify by listing all the patient's timepoints + folders before acting).

**2. Classify each photo (vision):** read each JPG and assign it to one of the 8 views
using the recognition column in [§3](#the-8-standard-view-codes-grid-layout). Verify
completeness: exactly one photo per view, all 8 present. Apply the L/R rule for the
two buccals with care.

**3. Place files into `working/`** — prefix `= {personId}0{tpCode}` (note the literal
`0`; for personIDs that prefix one another this exact form avoids collisions). Per
view:

```js
// node (sharp is a project dep, CommonJS-importable)
const sharp = require('sharp'), fs = require('fs');
const JPEG = { quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' };
const prefix = '407300';                 // personId 4073 + '0' + tpCode 0
const work = 'C:/clinic1/working';

// facial w/ EXIF rotation  → bake upright
await sharp(src).autoOrient().jpeg(JPEG).toFile(`${work}/${prefix}.i12`);
// occlusal (i23/i24)       → autoOrient + VERTICAL flip
await sharp(src).autoOrient().flip().jpeg(JPEG).toFile(`${work}/${prefix}.i23`);
// other intraoral / upright facial → lossless copy
fs.copyFileSync(src, `${work}/${prefix}.i22`);
```

Working filenames are **lowercase `.i{view}`** (what `getImageSizes` reads).

**4. Insert the DB rows** — `image_file` uses **uppercase `.I{type}`**; `image_date` =
the timepoint date; `title` and `dolphin_tpi_id` are left NULL on native inserts. The
`(time_point_id, image_type)` unique constraint makes this idempotent.

```sql
INSERT INTO time_point_images (time_point_id, person_id, image_type, image_file, image_date, title)
VALUES
  (2332, 4073, '10', '407300.I10', '2023-10-15', NULL),
  (2332, 4073, '12', '407300.I12', '2023-10-15', NULL),
  -- … 13,20,21,22,23,24 …
  (2332, 4073, '24', '407300.I24', '2023-10-15', NULL)
ON CONFLICT (time_point_id, image_type) DO UPDATE SET
  image_file = EXCLUDED.image_file,
  image_date = EXCLUDED.image_date,
  person_id  = EXCLUDED.person_id;
```

**CDC:** a plain `INSERT`/`DELETE` via psql fires the `cdc_capture` trigger (no
`app.cdc_origin` set ⇒ treated as a local-origin write) so it replicates to the
Supabase mirror automatically — no manual mirror write. New `time_point_image_id`s
come out **odd** (local sequences `INCREMENT BY 2`); seeing odd IDs confirms the
local-origin identity split is intact. (See `docs/sync-cdc.md`.)

**5. Verify:**

```js
// dimensions + orientation of all 8 working files
for (const v of ['i10','i12','i13','i23','i24','i20','i22','i21'])
  console.log(v, await sharp(`C:/clinic1/working/${prefix}.${v}`).metadata());
```
- Facials: portrait, `orientation` 1/undefined. Intraorals: landscape.
- Occlusals visually correct (upper: incisors top; lower: incisors bottom).
- `SELECT count(*) FROM time_point_images WHERE time_point_id = …;` → 8.

To eyeball a `working/` file (it has no image extension, so the Read tool refuses the
raw file), make a small preview and delete it after:
`sharp(file).resize(700).jpeg().toFile(tmp)` → view → remove.

### 5c. Gotchas (each cost a wrong turn the first time)

- **`$PID` is read-only in PowerShell** (it's the process id). Don't name a loop var
  `$pid` — assignment throws `VariableNotWritable` and silently breaks every path you
  build from it. Use `$person`/`$personId`.
- **`dolphin_tp_id` / `dolphin_tpi_id` are `uuid`** — `COALESCE(col,'')` errors with
  `invalid input syntax for type uuid`. Cast first: `col::text`.
- **Don't crop.** The clinic wanted images placed, not reframed. `autoOrient` and
  `flip` are orientation fixes, not crops — they're fine. Resizing/extracting is not.
- **Left/Right buccal is the highest-risk error** and the occlusal vertical flip can't
  correct it (different axis). Confirm L/R against the frontal landmark before inserting.
- **Occlusal flip is `.flip()` (vertical), never `.flop()` (horizontal).**

### 5d. Optional follow-up not done by default

The Photo Editor tags each source original with a `{view}-` filename prefix (e.g.
`i12-IMG_2495.JPG`, see `shared/photo-views.ts` + `photo-original-tags.ts`) so
reopening a slot re-hydrates its source for re-editing. Manual placement skips this
(it renames the patient's originals). The grid displays fine without it; add the tags
only if the user wants editor re-hydration.

---

## 6. History — the decommissioned Dolphin dependency

This flow once integrated with **Dolphin Imaging**: timepoint data was read/written
through six cross-database stored procs into the `DolphinPlatform` SQL Server database,
and a `dolphin:` desktop protocol handler opened the native app. That is all gone — the
procs were dropped, the protocol handler removed, and the data migrated into the
PostgreSQL tables above. The one-time SQL-Server-era migration scripts
(`migrations/clone_dolphin_timepoints.sql`, `migrations/cutover_dolphin_native.sql`)
survive only as historical artifacts; the current schema is owned by
`migrations/pg/*.sql` + `types/db.d.ts`.

The **only** remaining Dolphin touch point is unrelated to this flow: a temporary,
one-way CDC **"dolphin" sink** that pushes selected rows into the legacy Dolphin
Imaging SQL Server (the sole reason `mssql` + `services/database/pool.ts` still exist).
It is documented in `docs/sync-cdc.md` and goes away when that sink is deleted. The app
never reads from `DolphinPlatform`, and **`DolphinPlatform` must never be modified by
this app.**
