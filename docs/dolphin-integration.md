# Dolphin Imaging Integration

How the app links patients, timepoints, and photos with **Dolphin Imaging**, and
how original photos are stored on disk in parallel with Dolphin's own repository.

---

## 1. Two databases, one SQL instance

Dolphin's data lives in a **separate database, `DolphinPlatform`**, on the same
SQL Server instance as the app's `ShwanNew` database (`Clinic\DOLPHIN`).

The app **never queries `DolphinPlatform` directly.** Instead it calls a set of
**stored procedures that live in `ShwanNew`**, which cross-database into
`DolphinPlatform.dbo.*`:

| Stored procedure       | Purpose                                                        | Called from |
|------------------------|----------------------------------------------------------------|-------------|
| `CheckDolphin`         | Does this patient exist in Dolphin?                            | `dolphin-queries.ts` |
| `AddDolph`             | Create the patient in Dolphin                                  | `dolphin-queries.ts` |
| `ChkTimePoint`         | Does a timepoint with this name/date already exist?           | `dolphin-queries.ts` |
| `AddTimePoint`         | Create a timepoint, return its `tpCode`                       | `dolphin-queries.ts` |
| `ListDolphTimePoints`  | List a patient's timepoints (code, date, description)         | `timepoint-queries.ts` |
| `ListTimePointImgs`    | List image filenames for a timepoint                          | `timepoint-queries.ts` |

### Patient linkage

The two systems are joined on:

```
DolphinPlatform.dbo.Patients.patOtherID  =  ShwanNew PersonID
```

Dolphin's own primary key, `PatID`, is an internal **GUID** and is never exposed
to the app — `patOtherID` is the bridge.

### Timepoints

`DolphinPlatform.dbo.TimePoints` is keyed by `PatID` and holds:

- **`tpCode`** — sequential per patient (`0, 1, 2, …`); the authoritative handle.
- **`tpDateTime`** — the date of the photo session.
- **`tpDescription`** — `Initial`, `Progress`, or `Final`.

> **Date gotcha:** `tpDateTime` is a wall-clock date. The mssql pool runs with
> `useUTC: false`, so it must be returned as a `YYYY-MM-DD` string (via
> `toDateOnly()` in `utils/date.ts`), never a raw `datetime` — otherwise
> `toISOString()` shifts midnight values back a day on the client. See the
> Database "Gotchas" section in `CLAUDE.md`.

---

## 2. Photo import flow

```
Browser                    Express (dolphin.routes.ts)              Desktop handler
  │  POST import              │                                          │
  ├──────────────────────────►│                                          │
  │                           │ 1. checkDolphinPatient / AddDolph        │
  │                           │ 2. AddTimePoint  →  tpCode               │
  │                           │ 3. mirror Initial/Final date into        │
  │                           │    ShwanNew.tblwork (conflict-checked)   │
  │  { protocolUrl, tpCode }  │                                          │
  │◄──────────────────────────┤                                          │
  │  navigate to dolphin:…     ───────────────────────────────────────► │ (OS protocol)
```

The server returns a `dolphin:` **protocol URL**, e.g.:

```
dolphin:6524?action=photos&tp=1&tpName=Progress&date=07-05-2026&skip=0
```

For **Initial / Final** timepoints, the server also mirrors `tpDateTime` into
`ShwanNew.tblwork.IPhotoDate` / `FPhotoDate` (`updatePhotoDate`), and if a
*different* date already exists on either the Shwan or Dolphin side it returns a
**conflict** that the UI must resolve (`overrideDate`) before proceeding.

---

## 3. Folder structure — photos are stored twice

Original photos are deliberately kept in **two** places: full-resolution camera
files on the `clinic1` share, **and** Dolphin's own ingested copies.

### a) Originals on the clinic1 share

The desktop protocol handler (`protocol-handlers/source/DolphinImagingProtocolHandler.cs`)
handles the `dolphin:` URL:

1. Creates a folder named **`{tpName}_{DD-MM-YYYY}`** under the patient's
   directory on the patients share (`PatientsFolder`):

   ```
   \\Clinic\clinic1\6524\Progress_07-05-2026\
   ```

2. Opens a file picker (defaulting to the camera **memory card** path) and
   **moves** the selected original files into that folder.

3. Writes the folder path into `Dolphin.ini` (`CaptureFromFilePath`) and launches
   Dolphin with **`/tp {tpCode}`**, so Dolphin ingests the *same originals* into
   its own repository under the matching timepoint.

> If `skip=1`, the files are just organized into the folder and **Dolphin is not
> launched** (organize-only mode).

**The folder ↔ timepoint binding is by convention:** the folder's `tpName_date`
mirrors the `TimePoints` row, while the numeric `tpCode` is what's actually passed
to Dolphin.

### b) Dolphin's exported view images (served to the app)

Dolphin exports per-view layout images into a **`working/`** folder, named:

```
{PersonID}0{tpCode}.i{viewCode}
```

e.g. `652401.i10` = patient 6524, timepoint 1, profile view. The app serves these
to the browser at **`/DolImgs/…`** (`express.static(pathResolver('working'))` in
`index.ts`).

#### View codes (fixed Dolphin layout slots)

| Code  | View            | Code  | View            |
|-------|-----------------|-------|-----------------|
| `i10` | Profile         | `i22` | Frontal / center |
| `i12` | Rest            | `i23` | Upper occlusal  |
| `i13` | Smile           | `i24` | Lower occlusal  |
| `i20` | Right buccal    | `i21` | Left buccal     |

This is the standard 8-view orthodontic photo set (the app's photo grid lays them
out around the practice logo).

---

## 4. Related paths & files

| Concern                          | Location |
|----------------------------------|----------|
| Cross-DB Dolphin queries         | `services/database/queries/dolphin-queries.ts` |
| Timepoint list / images          | `services/database/queries/timepoint-queries.ts` |
| Import endpoint + conflict logic | `routes/api/dolphin.routes.ts` |
| View-image filenames + sizing    | `services/imaging/index.ts` (`getImageSizes`) |
| `/DolImgs` static mount          | `index.ts` |
| Desktop protocol handler         | `protocol-handlers/source/DolphinImagingProtocolHandler.cs` |
| X-rays (separate, under `OPG/`)  | `services/imaging/index.ts` (`processXrayImage`), `patient-queries.ts` |

X-rays are a separate flow: they live under `clinic1/{PersonID}/OPG/` (with CS
Imaging metadata under `.csi_data/.version_4.4/`) and are converted to PNG via
`cs_export`, not through the Dolphin timepoint mechanism above.
