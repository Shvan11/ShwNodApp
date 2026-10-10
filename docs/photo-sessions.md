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
| `image_types` | Dolphin's slot-code dictionary: its 34 codes with Dolphin's names and ids (e.g. `10`=Facial Right, `22`=IntraOral Center, `51`=X-ray Panoramic), plus `25`/`60`/`61`, which hold images here but aren't Dolphin types (added 2026-10-09). `label` is the clinic's own name for a slot (Settings → Lookups → Photo Slot Names; NULL = built-in). Reference only; not FK-enforced. Only the Dolphin sink reads it, but **keep it when that sink goes**: it is the only record of what a legacy `.Inn` code means. |

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
resize → jpeg`, written atomically to `working/{personId}{tpCode:02}.i{viewCode}`,
plus a row upserted into `time_point_images`. On completion the route emits
`PHOTO_TIMEPOINT_RENDERED` over SSE so the open photo grid refetches (the SSE key is
`tpCode`, camelCase — see the note in `photo-editor.routes.ts`). See
`services/imaging/photo-render.service.ts`.

**The framing record — "Continue editing".** Each render also records how the view was
framed: zoom, rotation, mirror/flip, and the frame itself (react-easy-crop's
`croppedAreaPercentages` — % of the flipped + rotated original, so it is independent of
the 2048 px proxy vs the original), plus the original it was cut from (clean name, the
listing's mtime, post-EXIF size). It is stored **inside the rendered JPEG as XMP**
(`services/imaging/photo-framing-xmp.ts`; shape `savedFraming` in the contract), not in
a table: the record always describes exactly the pixels it sits in, a view re-rendered
any other way (Dolphin, a build before 2026-10-05) simply carries none, and removing a
view removes its record. No schema change, so nothing to mirror to Supabase.
`GET /api/photo-editor/:id/framing/:tpCode` reads it back (header-only). A saved slot
then offers both re-edit routes: **Continue editing** (its tagged original, framed as
saved — offered only while that original is still the file the record names, by name +
mtime) and **Start over from original** (default framing). A view saved without a record
offers only Start over, and the menu says why.

**Re-crop.** One route needs no original: **Recrop the saved photo** frames the saved
view itself, so a Dolphin-era view, or one whose original is gone, can still be
re-framed. It opens in the largest frame of the view's aspect, centred
(`framing.ts#coverArea`): Dolphin's renders are often about 1 % off the aspects the editor
renders, so no frame holds all of one, and a whole-photo frame used to read as a change
the moment it opened. Save cuts the saved render in place (a crop of a crop: it can tighten, turn
and straighten, but not take in more of the picture) and records no framing, since the
render it was framed on is the one it replaces. The photo grid's right-click **Re-crop**
opens the editor at `?recrop={view}`: that view is selected and, once the editor has read
what is saved (gallery, framing, session folder — none still refetching), opens in its
cropper framed as it is now — over its original when the save recorded the framing
(Continue editing), else over the saved photo (`usePhotoEditorState.ts`, `RECROP`).

**What counts as a change.** A slot is *unsaved* only when Save would change what is on
disk: a newly placed photo, or a re-opened one whose framing moved from the saved one
(`framing.ts#isSlotDirty`, 0.25 % tolerance). So reopening a view and leaving it is not a
change, **Save writes only the changed slots**, and **Cancel** asks before leaving only
when something would be lost. Each slot's title bar shows *Saved* / *Unsaved*; the top
bar counts the unsaved ones. "Discard changes" on an edited saved view brings the saved
photo back; "Reset framing" returns to where the edit started (the saved framing after
Continue, else the default).

**Readout.** Beside the quick actions, the selected slot's zoom (100 % = the photo just
fills the frame), rotation, flips (the occlusal default flip included), the resolution
the save will keep (a view keeps the crop's native pixels; in Fast-preview mode the
original's size comes from `GET /api/photo-editor/:id/source-size`), a warning under
2 MP, and a **White edge** warning when the frame runs past the photo — those parts are
saved white (the live preview shows them dark). Zoom and rotation reset individually on
click. For a saved view the recorded values show read-only.

**Overlay.** A toggle lays another session's saved views (the grid's 480 px thumbnails)
faintly over the slots, stretched to the slot box — the box is the view's frame — so a
new session can be framed like the last one. Default session: the latest one before
this; on/off and strength persist per device (`pe:overlay`, `pe:overlayOpacity`).

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

- **Timepoint tabs / lists** — `getTimePoints()`
  (`services/database/queries/timepoint-queries.ts`) reads the local table, ordered by
  date then code. Used by the staff grid, Navigation, Compare, slideshow and the
  patient portal (`routes/portal.ts`).
- **View images** — served at **`/DolImgs/{personId}{tpCode:02}.i{viewCode}`**
  (`express.static(workingDir())` in `index.ts`; the `/DolImgs` mount name is
  historical). `getImageSizes()` (`services/imaging/index.ts`, the gallery endpoint)
  probes the 8 fixed filenames on disk — lower case first, then the Dolphin-era upper
  case — with no DB lookup, and returns each view's real name, pixel size and an
  `mtime` cache-bust token. **Every reader takes names and versions from it** (grid,
  editor, Compare, slideshow, the Works card, the chair kiosk): an edited slot
  re-renders to the SAME filename and `/DolImgs` is served `immutable`, so a URL
  without `?v={mtime}` shows a stale render for up to a year, and a rebuilt name
  404s on a case-sensitive volume (audit FE-F13-1/-5/-8). The DB's
  `time_point_images` rows are not a file list.
- **"Has final photos" patient filter** — `patient.routes.ts` runs an `EXISTS`
  against `time_points`.

### The 8 standard view codes (grid layout)

The filename prefix is `{personId}{tpCode as two digits}`, Dolphin's own rule (e.g.
patient 4073, tpCode 0 → `407300`; patient 634, tpCode 12 → `63412`). Build it with
`services/files/working-file-names.ts`, never by hand: until 2026-10-07 the app wrote
`{personId}0{tpCode}`, which only matches Dolphin for sessions 0–9. The **working**
file uses lowercase `.i{view}`; the DB `image_file` uses uppercase `.I{type}` (the view
code minus the leading `i`).

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

### Dolphin's other slots — legacy

The 8 views are 8 of Dolphin's 34 slot codes. The others hold about 1,000 of this
clinic's images (2026-10), all made in Dolphin:

- **X-rays**: `51` OPG (~690), `50` lateral ceph (~160), `01` ceph (19), and a few
  frontal, occlusal and periapical films in `52`–`57`.
- **Close-ups**: Dolphin has no close-up type, so they went into spare slots. **Smile
  close-ups are in `02`** (Dolphin's "Ceph Front", ~100), intraoral close-ups in `25`,
  `60` and `61` (codes Dolphin's table doesn't define).
- A handful in `00`, `04`, `33` and `40`–`42`.

The working-files listing returns them with the 8 views. The grid flags a session that
has some (a tab icon and a "+ …" chip) and the Working files page shows them. The app
never writes these slots; the X-rays page reads the patient's `OPG` folder instead.

**Slot names are the clinic's.** What a spare slot holds was each clinic's choice, so a
clinic names its slots in Settings → Lookups → Photo Slot Names (`image_types.label`,
`routes/api/photo-slot.routes.ts`; this clinic: `02` = "Smile close-up"). A slot without
a name shows its built-in one: the X-ray name (`shared/photo-views.ts#XRAY_SLOT_LABELS`)
or "Image". The working-files listing carries each entry's `label`, which is how the
Working files page and the grid's chip and tab tooltip get it. The 8 grid views can't be
renamed. The editor lists only codes some photo uses, and appears only on an install
that has any.

### Dolphin's originals (`.vNN` "V files") — legacy, being phased out

A slot Dolphin filled has two files in `working/`: the image (`.iNN`, cropped/rotated,
what every screen shows) and Dolphin's untouched original of it (`.vNN`: the full camera
frame or X-ray; JPEG, some TIFF/BMP/PNG). The app never writes a `.vNN` (its originals
live in the session folder), so they exist only for Dolphin-era slots and are being
phased out. Don't build features on them.

- The Working files page lists each `.vNN` right after its image, tagged "V file"
  (`original: true` in the listing). The content route sniffs the bytes
  (`utils/file-mime.ts#sniffImageMime`): TIFF is shown as PNG, bytes that aren't an image
  are download-only. sharp can't read BMP, so those tiles show an icon.
- **Image and original are a pair: every delete takes both, to the patient's trash**
  (`clinic1/.trash/{pid}/{stamp}/working/`): the Working files page's Delete (named by
  either file; both or neither), the editor's Remove, and a session delete (*cropped* →
  the 8 views; *entry*/*all* → every slot of the session, so nothing is left under a code
  the next session may reuse). A patient delete purges them with everything else. Each
  confirm names the V files only when the slot or session has some.
- **A `.vNN` without its image is not necessarily garbage.** In a session that still
  exists it is usually the only copy of a view the session no longer shows (an OPG, a
  buccal, a frontal): 186 of the 193 such sessions found in 2026-10 had no originals
  folder. Check the session before removing one, and when V files are phased out, move
  these into the session's originals folder rather than delete them.
- 2026-10-09: a cleanup moved the 289 `.vNN` that had no image to the trash (manifest
  `clinic1/.trash/orphaned-v-files-2026-10-09T15-15-56-542Z.csv`). 272 of them were in
  sessions that still exist and were put back the same day
  (`restored-v-files-2026-10-09T17-47-08-283Z.csv`); left in the trash are the 16 whose
  session is gone and `72101.V60`, whose image was deleted from the Working files page.
  After a per-file review, 268 of the 272 became their slot's image (`.Vnn` → `.Inn`;
  the 15 TIFF and 1 BMP written as JPEG, their originals to the trash) with a photo record
  each, dated like the session's other photos, and 4 went to the trash
  (`v-file-choices-applied-2026-10-09T19-10-56-187Z.csv`, `…T19-11-18-989Z.csv`). No live
  session was left with a `.vNN` missing its image.
  The 59 that became an occlusal view (`i23`/`i24`) were Dolphin's raw mirror shots, so they
  showed the arch reversed. 57 were flipped vertically the same evening, as Dolphin's own
  renders are (each original to the patient's trash; manifest
  `occlusal-flips-2026-10-09T19-59-17-962Z.csv`); `9301.I23` (not an occlusal view) and
  `80100.I24` (shot without the mirror) were already right. Dolphin-era slot mix-ups seen
  then: `78000.I23`/`.I24` hold each other's arch, `90601.I24` is an upper occlusal, and
  `80100.I23` is a second lower one.
  The 51 slot files whose session no longer existed (deleted patients and sessions, a
  `00.*` set with no patient number, and byte-identical copies of patient 304's sessions
  10/11 left under the pre-fix `{id}0{tp}` name) were trashed too; manifest
  `clinic1/.trash/sessionless-working-files-2026-10-09T15-29-48-378Z.csv`.

---

## 4. Related paths & files

| Concern | Location |
|---------|----------|
| Timepoint reads (local tables) | `services/database/queries/timepoint-queries.ts` |
| Timepoint/image writes (find-or-create, upsert, update, delete) | `services/database/queries/native-timepoint-queries.ts` |
| Photo-session prep helpers (patient, dates, tblwork conflict) | `services/database/queries/photo-session-queries.ts` |
| Prepare / render / photo-dates / delete-view / framing / source-size endpoints | `routes/api/photo-editor.routes.ts` |
| Server-side sharp render (embeds the framing record) | `services/imaging/photo-render.service.ts` |
| Framing record: XMP encode/decode (pure) + reads | `services/imaging/photo-framing-xmp.ts`, `photo-framing.service.ts` |
| Editor framing maths (dirty check, white edge, resolution) | `public/js/components/react/photo-editor/framing.ts` |
| View-image sizing + `/DolImgs` static mount | `services/imaging/index.ts`, `index.ts` |
| Working gallery: list/serve/delete a patient's slot files (image + V-file pairs) | `services/files/working-files.service.ts`, `services/imaging/photo-cleanup.service.ts` |
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

**3. Place files into `working/`** — prefix `= {personId}{tpCode as two digits}`
(`407300` for session 0, `407312` for session 12), Dolphin's rule. Per view:

```js
// node (sharp is a project dep, CommonJS-importable)
const sharp = require('sharp'), fs = require('fs');
const JPEG = { quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' };
const prefix = '407300';                 // personId 4073 + tpCode 0 as two digits
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
