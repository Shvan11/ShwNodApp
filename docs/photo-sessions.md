# Photo Sessions (native)

How the app captures, stores, and serves a patient's orthodontic photo sets. This
is **fully self-contained** — it no longer depends on the Dolphin Imaging desktop
software or its `DolphinPlatform` database. (Historical note: this flow replaced a
Dolphin integration; the cutover lives in `migrations/cutover_dolphin_native.sql`.)

---

## 1. Data model — local, PersonID-keyed

Everything lives in `ShwanNew` (sandbox: `ShwanNew_Test`), keyed by `PersonID`:

| Table | Purpose |
|-------|---------|
| `dbo.tblTimePoints` | One row per photo session — `tpCode` (sequential per patient, the authoritative handle), `tpDescription` (`Initial`/`Progress`/`Final`/`Retention`), `tpDateTime` (date-only). |
| `dbo.tblTimePointImages` | One row per view image — `ImageType` (2-digit view code, e.g. `10`/`22`), `ImageFile`, `ImageDate`. FK → `tblTimePoints` (cascade). |
| `dbo.tblImageTypes` | Code→label dictionary (e.g. `10`=Facial Right, `22`=IntraOral Center, `51`=X-ray Panoramic). Reference only; not FK-enforced. |

> **Date gotcha:** `tpDateTime` is a wall-clock date. Return it as a `YYYY-MM-DD`
> string (`CONVERT(varchar,col,23)` or `toDateOnly()`), never a raw `datetime` —
> the pool runs `useUTC:false` and `toISOString()` would shift midnight back a day.
> See the Database "Gotchas" in `CLAUDE.md`.

`tpCode` is allocated `MAX(tpCode)+1` per patient under `UPDLOCK, HOLDLOCK`
(`findOrCreateNativeTimePoint`); the photo editor is the sole allocator, so the
flat `working/` namespace keyed by `(PersonID, tpCode, view)` can't collide.

---

## 2. Capture flow

```
Navigation / ViewPatientInfo
        │  "Photo Layout" / "Add Photos"
        ▼
 PhotoSessionDialog  ── GET  /api/photo-editor/:id/photo-dates  (appointment/visit date hints)
        │             ── POST /api/photo-editor/:id/prepare      (find/create timepoint;
        │                                                         Initial/Final mirror into
        │                                                         tblwork.IPhotoDate/FPhotoDate
        │                                                         with conflict/override)
        ▼  onPrepared → navigate
 /patient/:id/photo-editor/tp{tpCode}   (PhotoEditor)
        │  drag originals into the 8 view slots, frame each
        │  (react-easy-crop: zoom/pan/rotate/crop + flip/mirror)
        ▼  Save
   POST /api/photo-editor/:id/render
```

**Render (server, sharp):** per slot `autoOrient → flip/flop → rotate → extract →
resize → jpeg`, written atomically to `working/{PersonID}0{tpCode}.i{viewCode}`,
plus a row upserted into `tblTimePointImages`. See
`services/imaging/photo-render.service.ts`.

**Getting originals onto the share:** photos are uploaded per-patient via the file
explorer (`POST /api/patients/:id/files/upload`, or copied to the LAN share) into a
`{tpName}_{DD-MM-YYYY}` folder; the editor's sidebar lists them via
`GET /api/patients/:id/files`. No external importer is involved.

---

## 3. Reads & serving

- **Timepoint tabs / lists** — `getTimePoints()` / `getTimePointImgs()`
  (`services/database/queries/timepoint-queries.ts`) read the local tables. Used by
  the staff grid, Navigation, Compare, slideshow, the patient portal
  (`routes/portal.ts`), and the chair display.
- **View images** — served at **`/DolImgs/{PersonID}0{tpCode}.i{viewCode}`**
  (`express.static(pathResolver('working'))` in `index.ts`). `getImageSizes()`
  (`services/imaging/index.ts`) probes the 8 fixed filenames on disk — no DB lookup.
- **"Has final photos" patient filter** — `patient.routes.ts` EXISTS against
  `dbo.tblTimePoints`.

### The 8 standard view codes (grid layout)

| Code  | View            | Code  | View             |
|-------|-----------------|-------|------------------|
| `i10` | Profile         | `i22` | Frontal / center |
| `i12` | Rest            | `i23` | Upper occlusal   |
| `i13` | Smile           | `i24` | Lower occlusal   |
| `i20` | Right buccal    | `i21` | Left buccal      |

(The full set of codes the data may contain is in `tblImageTypes`; the grid lays
these 8 out around the practice logo.)

---

## 4. Related paths & files

| Concern | Location |
|---------|----------|
| Timepoint reads (local tables) | `services/database/queries/timepoint-queries.ts` |
| Timepoint/image writes | `services/database/queries/native-timepoint-queries.ts` |
| Photo-session prep helpers (patient, dates, tblwork conflict) | `services/database/queries/photo-session-queries.ts` |
| Prepare / render / photo-dates endpoints | `routes/api/photo-editor.routes.ts` |
| Server-side sharp render | `services/imaging/photo-render.service.ts` |
| View-image sizing + `/DolImgs` | `services/imaging/index.ts`, `index.ts` |
| Editor UI | `public/js/components/react/photo-editor/`, `PhotoSessionDialog.tsx` |
| Local-table clone + ImageTypes dictionary | `migrations/clone_dolphin_timepoints.sql` |
| Cutover (drops the old cross-DB procs) | `migrations/cutover_dolphin_native.sql` |

X-rays are a separate flow: under `clinic1/{PersonID}/OPG/` (CS Imaging metadata in
`.csi_data/.version_4.4/`), converted to PNG via `cs_export` — unchanged by this work.

---

## 5. DolphinPlatform (decommissioned dependency)

The `DolphinPlatform` database still exists on the `Clinic\DOLPHIN` instance as the
Dolphin desktop software's own data store, but **the app no longer reads or writes
it.** The six cross-database procs (`CheckDolphin`, `AddDolph`, `ChkTimePoint`,
`AddTimePoint`, `ListDolphTimePoints`, `ListTimePointImgs`) were dropped from
`ShwanNew_Test`, and the `dolphin:` desktop protocol handler was removed. The only
remaining touch point is the **read-only** clone migration, run once to copy
reference data into the local tables. **Never modify `DolphinPlatform`.**
