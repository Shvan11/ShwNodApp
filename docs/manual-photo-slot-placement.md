# Manual photo-slot placement runbook

How to take a folder of raw clinical photos for one timepoint and wire them into
the app **by hand** — classify each photo into its view slot, place the rendered
file in `working/`, and insert the matching `time_point_images` rows — so the
timepoint's photo grid lights up exactly as if it had been processed through the
native Photo Editor.

This is the recovery path for **orphaned timepoints**: a `time_points` row whose
source photos exist on disk (in the originals folder `clinic1/{pid}/{name}_{DD-MM-YYYY}/`)
but which has **0 `time_point_images` rows and no `working/` render files** — so the
grid shows an empty tab. (First encountered 2026-06-12, patient 4073, tp 2332.)

> Prefer the real Photo Editor UI when a human is available — it crops, previews,
> and applies the transforms interactively. This runbook is for bulk/headless
> repair where driving the UI per-photo isn't practical.

---

## The model (read these source files first — they are the source of truth)

| Concern | File | Key fact |
| --- | --- | --- |
| View codes + order | `shared/photo-views.ts` | `VIEW_CODES = ['i10','i12','i13','i23','i24','i20','i22','i21']` |
| View → anatomy labels | `public/js/components/react/GridComponent.tsx` (~line 115) | the `fileNameMap` |
| What the grid reads | `services/imaging/index.ts` `getImageSizes` | reads `working/{pid}0{tp}.i{view}` **lowercase** |
| Working-dir paths | `services/files/clinic-paths.ts` | `workingDir()` = `clinic1/working`; file = `{pid}0{tp}.i{view}` |
| DB write convention | `services/database/queries/native-timepoint-queries.ts` `upsertNativeTimePointImage` | `image_file` = `{pid}0{tp}.I{type}` **uppercase I** |
| Editor default transforms | `public/js/components/react/photo-editor/photoEditorTypes.ts` | `defaultFlipV()`, `VIEW_OUTPUT` aspect ratios |
| Render pipeline | `services/imaging/photo-render.service.ts` | transform order, JPEG opts |
| Originals folder name | `services/imaging/photo-cleanup.service.ts` `timepointFolderName` | `{tp_description}_{DD-MM-YYYY}` |

### The 8 views — code, DB type, anatomy, how to recognise it

The filename prefix is `{personId}0{tpCode}` (e.g. patient 4073, tpCode 0 →
`407300`). `image_type` is the view code **minus the leading `i`**.

| Grid pos | Working file (`i` lowercase) | DB `image_type` | DB `image_file` (`I` upper) | `image_types.description` | How to identify |
| --- | --- | --- | --- | --- | --- |
| top-L | `…​.i10` | `10` | `…​.I10` | Facial Right | Side **profile** of the face |
| top-M | `…​.i12` | `12` | `…​.I12` | Facial Front | Frontal face, **lips at rest** (mouth closed) |
| top-R | `…​.i13` | `13` | `…​.I13` | Facial Front/Smile | Frontal face, **smiling**, teeth showing |
| mid-L | `…​.i23` | `23` | `…​.I23` | IntraOral UpperOcc | **Upper occlusal** — palate/rugae visible |
| mid-R | `…​.i24` | `24` | `…​.I24` | IntraOral LowerOcc | **Lower occlusal** — tongue/floor of mouth visible |
| bot-L | `…​.i20` | `20` | `…​.I20` | IntraOral Right | Buccal: **incisors on photo RIGHT**, molars left |
| bot-M | `…​.i22` | `22` | `…​.I22` | IntraOral Center | Front teeth in occlusion, retractors |
| bot-R | `…​.i21` | `21` | `…​.I21` | IntraOral Left | Buccal: **incisors on photo LEFT**, molars right |

(Grid layout is 3×3 with `logo.png` in the centre — see `getImageSizes`.)

---

## The three transforms that bite — replicate the editor's defaults

Placing a photo "correctly" is **not** a raw copy for every view. The native
editor applies per-view defaults; a manual placement must reproduce them or the
grid looks wrong. No cropping is needed (and the clinic asked for none), but
**orientation and mirror-flip are mandatory**:

1. **Facial photos carry EXIF orientation.** Portrait facials are often stored as
   landscape pixels + an EXIF orientation tag (we saw `orientation = 8`). Browsers
   honour EXIF and show them upright, but `getImageSizes` (the `image-size` lib)
   does **not** apply EXIF, so it reports landscape dims and the grid slot
   distorts. → **Bake the rotation** with `sharp().autoOrient()` so the stored
   pixels are upright and `orientation` becomes `1`/undefined. (No-op for photos
   already at `orientation = 1`.)

2. **Occlusal views are mirror-shot → vertical flip.** `defaultFlipV()` returns
   `true` for `i23`/`i24` only. Upper/lower occlusals are taken through an
   intraoral mirror, so they arrive mirror-reversed and must be flipped
   **vertically** (`sharp().flip()` = top↔bottom; **not** `.flop()`). `flipH`
   stays `false`. After the flip: upper occlusal → incisors at top; lower
   occlusal → incisors at bottom. **This is easy to forget** — it was the one
   miss on the first run.

3. **Everything else (the 5 non-occlusal intraorals + already-upright facials)**
   is a lossless straight copy — no re-encode, no crop.

Match the editor's JPEG settings when you do re-encode (bake/flip):
`{ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }` (from
`photo-render.service.ts`).

### Left vs Right buccal — the dangerous one. Get it right.

Buccal laterals (`i20` Right, `i21` Left) are **direct, non-mirror** retracted
shots. The deterministic rule for a direct upright shot:

> **Incisors on the photo's RIGHT ⇒ patient's RIGHT side ⇒ `i20`.**
> **Incisors on the photo's LEFT ⇒ patient's LEFT side ⇒ `i21`.**

Two independent confirmations of this (it is counter-intuitive — a first guess
often inverts it):

- **Vector geometry.** Camera on the patient's right, optical axis pointing
  medially (`-x̂`), up `+ẑ`. Image-right `= forward × up = (-x̂) × ẑ = +ŷ` =
  patient anterior. So anterior/incisors land on the **right** of a right-buccal
  photo.
- **The app's composite layout.** Right (`i20`) sits bottom-**left** of the grid,
  Left (`i21`) bottom-**right** — i.e. arranged as if facing the patient. Each
  lateral's anterior points **toward the centre** slot, so the right-lateral
  (left of centre) has its incisors on its **right** edge.

If unsure, cross-check a **mirror-invariant unilateral landmark** (an amalgam,
uniquely rotated/peg tooth, a band) against the **frontal** photo (`i22`), which
is unambiguous: in a direct frontal, the **patient's right side is on the image's
left** (they face the camera). A vertical flip does **not** swap left↔right; only
a horizontal flip would — so occlusal flipping can't fix a buccal L/R error.

---

## Procedure

### 0. Environment / connection notes (this box, 2026-06)

- **`psql.exe`**: `C:\Program Files\PostgreSQL\18\bin\psql.exe`.
- **DB**: from the Windows host use `-h localhost`; the `.env` `PG_HOST=172.20.0.1`
  is the WSL→host gateway (works from the WSL Bash tool, which reaches the host's
  Postgres over the network).
- **Filesystem**: `C:\clinic1` lives on the **Windows host**. The WSL Bash tool
  here has **no `/mnt/c`** mount — do disk work from PowerShell, or run `node`
  (which is on the Windows host) against `C:/…` paths.
- Creds for the app role: user `shwan_app`, see `.env` `DATABASE_URL`.

### 1. Find orphaned timepoints (no images **and** no folder vs. has-folder)

```sql
-- timepoints with zero image rows
SELECT tp.time_point_id, tp.person_id, tp.tp_code,
       tp.tp_description, to_char(tp.tp_date_time::date,'DD-MM-YYYY') AS folder_date
FROM time_points tp
WHERE NOT EXISTS (SELECT 1 FROM time_point_images i
                  WHERE i.time_point_id = tp.time_point_id)
ORDER BY tp.person_id, tp.tp_code;
```

For each, the expected originals folder is
`C:\clinic1\{person_id}\{tp_description}_{folder_date}`. **A "fuzzy" folder whose
date is off by a day is usually the real one** (record date vs. photo-session
date); a same-name folder at a *different* date/year usually belongs to a
**different** timepoint (verify by listing all the patient's timepoints + folders
before acting). See the sibling cleanup that produced this file.

### 2. Classify each photo (vision)

Read each JPG and assign it to one of the 8 views using the recognition column
above. Verify completeness: exactly one photo per view, all 8 present. Apply the
L/R rule for the two buccals with care.

### 3. Place files into `working/`

Prefix `= {personId}0{tpCode}` (note the literal `0` between them; for personIDs
that prefix one another this exact form avoids collisions). Per view:

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

### 4. Insert the DB rows

`image_file` uses **uppercase `.I{type}`**; `image_date` = the timepoint date;
`title` and `dolphin_tpi_id` are left NULL on native inserts. The
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

**CDC**: a plain `INSERT`/`DELETE` via psql fires the `cdc_capture` trigger
(no `app.cdc_origin` set ⇒ treated as a local-origin write) so it replicates to
the Supabase mirror automatically — no manual mirror write. New
`time_point_image_id`s come out **odd** (local sequences `INCREMENT BY 2`); seeing
odd IDs is the confirmation the local-origin identity split is intact.

### 5. Verify

```js
// dimensions + orientation of all 8 working files
for (const v of ['i10','i12','i13','i23','i24','i20','i22','i21'])
  console.log(v, await sharp(`C:/clinic1/working/${prefix}.${v}`).metadata());
```
- Facials: portrait, `orientation` 1/undefined. Intraorals: landscape.
- Occlusals visually correct (upper: incisors top; lower: incisors bottom).
- `SELECT count(*) FROM time_point_images WHERE time_point_id = …;` → 8.

To eyeball a `working/` file (it has no image extension, so the Read tool refuses
the raw file), make a small preview and delete it after:
`sharp(file).resize(700).jpeg().toFile(tmp)` → view → remove.

---

## Gotchas (each cost a wrong turn the first time)

- **`$PID` is read-only in PowerShell** (it's the process id). Don't name a loop
  var `$pid` — assignment throws `VariableNotWritable` and silently breaks every
  path you build from it. Use `$person`/`$personId`.
- **`dolphin_tp_id` / `dolphin_tpi_id` are `uuid`** — `COALESCE(col,'')` errors
  with `invalid input syntax for type uuid`. Cast first: `col::text`.
- **WSL has no `/mnt/c` here** — `C:\clinic1` is on the Windows host. Use
  PowerShell or host-side `node` for disk work; psql-over-network is fine from WSL.
- **Don't crop.** The clinic wanted images placed, not reframed. `autoOrient` and
  `flip` are orientation fixes, not crops — they're fine. Resizing/extracting is not.
- **Left/Right buccal is the highest-risk error** and the occlusal vertical flip
  can't correct it (different axis). Confirm L/R against the frontal landmark
  before inserting.
- **Occlusal flip is `.flip()` (vertical), never `.flop()` (horizontal).**

---

## Optional follow-up not done by default

The Photo Editor tags each source original with a `{view}-` filename prefix
(e.g. `i12-IMG_2495.JPG`, see `shared/photo-views.ts` + `photo-original-tags.ts`)
so reopening a slot re-hydrates its source for re-editing. Manual placement skips
this (it renames the patient's originals). The grid displays fine without it;
add the tags only if the user wants editor re-hydration.
