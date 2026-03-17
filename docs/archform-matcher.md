# Archform Patient Matcher

Links Archform (aligner design software) patients to aligner sets in the main database.

## What was added

- **`ArchformID` column** on `tblAlignerSets` (nullable INT)
- **`ARCHFORM_DB_PATH`** setting in `tbloptions` (editable in General Settings)
- **Backend service** (`services/archform/archform-db.ts`) — reads/writes Archform's SQLite DB via `better-sqlite3` with stale connection detection and auto-reconnect
- **5 API endpoints** in `aligner.routes.ts`:
  - `GET /api/aligner/archform/patients` — list Archform patients from SQLite
  - `GET /api/aligner/archform/matches` — list aligner sets with ArchformID, FirstName, LastName
  - `PATCH /api/aligner/sets/:setId/archform` — save/clear a match
  - `PUT /api/aligner/archform/patients/:id` — edit patient name in Archform DB
  - `DELETE /api/aligner/archform/patients/:id` — cascading delete patient + all related data from Archform DB, clears SQL Server references
- **Frontend page** (`ArchformMatcher.tsx`) — table with:
  - **Match/Unmatch**: dropdown to link Archform patients to aligner sets
  - **Sortable columns**: Name, Created, Modified (asc/desc toggle)
  - **Inline edit**: pencil icon to rename patient directly in Archform DB
  - **Auto-rename**: magic wand icon (matched patients only) — sets Archform Name to `FirstName LastName` and LastName to `Dr_DoctorName_SetSequence` using English name fields from `tblpatients`. Validates that English names exist and contain Latin characters; shows warning if not.
  - **Delete**: trash icon with confirmation dialog, cascading delete of all related Archform data
  - **Filter**: by name text and match status (matched/unmatched)
- **4th toggle button** ("Archform Match") in the aligner section nav, route at `/aligner/archform-match`

## Setup

### Database Location

The Archform database (`__ARCHFORMDB`) is on **workPC** at:
```
C:\Users\Shwan\AppData\Local\Archform\__ARCHFORMDB
```
The folder is shared on the LAN as **"Archform"**.

### Configuration

Set `ARCHFORM_DB_PATH` in General Settings (`tbloptions`) to point to the database file:
- **Windows production**: `\\workPC\Archform\__ARCHFORMDB` (UNC path, resolved via NetBIOS — works with dynamic IP)
- **WSL2 development**: `/mnt/archform/__ARCHFORMDB` (requires manual mount, see below)

### WSL2 Development Mount

The SMB share must be mounted manually before using this feature. The mount is **not persistent** — remount after restart or when workPC's IP changes.

```bash


# Mount the Archform share (replace IP if workPC's IP changed)
# IMPORTANT: nobrl and cache=none are required for SQLite writes over CIFS
sudo mount -t cifs //192.168.100.55/Archform /mnt/archform -o username=Shwan,password=12345,uid=1002,gid=1002,file_mode=0777,dir_mode=0777,vers=3.1.1,nobrl,cache=none
```

- **`nobrl`** — disables CIFS byte-range locks. Without this, SQLite commits fail with `SQLITE_BUSY` because CIFS cannot properly handle SQLite's lock promotion (RESERVED → EXCLUSIVE).
- **`cache=none`** — ensures fresh reads, no stale CIFS cache.
- **`uid=1002,gid=1002`** — matches the `administrator` user so the Node.js process has write access (without this, mount defaults to root-owned with 0755 permissions → `SQLITE_READONLY`).

> **Note**: WSL2 cannot resolve Windows hostnames (NetBIOS) — you must use the IP address. Check workPC's current IP with `ipconfig` on that machine.

## Cascading Delete

Deleting an Archform patient removes all related data in a single SQLite transaction. The relationship tree (Patient owns references outward via FK columns):

```
Patient
├── ScanPair        (OriginalScanPairId, ScanPairId — deduplicated)
├── MarkerSet       (MarkerSetId)
├── SegmentedGumsTeeth (SegmentedMeshesId)
├── ToothBoundaryCurves (BoundaryCurvesId)
├── GoalSet         (GoalSetId)
└── ToothInfoSet    (UpperToothSetId, LowerToothSetId — deduplicated)
    ├── ToothInfo[]    (packed int32LE blob: ToothIDs)
    ├── PonticInfo[]   (packed int32LE blob: PonticIDs)
    └── PonticV3Info[] (packed int32LE blob: PonticV3IDs)
```

- Archform uses sentinel values `0` and `-1` instead of NULL for "not set" — handled by `isValidFk()`.
- SQL Server `tblAlignerSets.ArchformID` references are cleared **before** the SQLite delete.

## Protocol Handler (Open in Archform)

A teal "Archform" button appears on set cards when `ArchformID` is matched. Clicking it triggers `archform:{id}` which:

1. **C# handler** (`protocol-handlers/source/ArchformProtocolHandler.cs`) writes the ID to registry `HKCU\Software\ArchForm\ArchForm\LastPatient_h2457475196`
2. Launches `archform.exe` (path from `ProtocolHandlers.ini` → `ArchformPath`)
3. Archform reads the registry value on startup and opens that patient

Install via `INSTALL.bat` (option 5). Optional `ArchformAllowedComputer` restricts to a single machine.

## Dependencies

- `better-sqlite3` + `@types/better-sqlite3`
