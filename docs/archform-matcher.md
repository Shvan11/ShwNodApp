# Archform Patient Matcher

Links Archform (aligner design software) patients to aligner sets in the main database.

## What was added

- **`archform_id` column** on `aligner_sets` (nullable `integer`)
- **`ARCHFORM_DB_PATH`** setting in the `options` table (editable in General Settings)
- **Backend service** (`services/archform/archform-db.ts`) — reads/writes Archform's SQLite DB via `better-sqlite3` with stale connection detection and auto-reconnect
- **API endpoints** in `routes/api/aligner-archform.routes.ts` (plus `GET /api/aligner/features`, which says whether a path is set):
  - `GET /api/aligner/archform/patients` — list Archform patients from SQLite
  - `GET /api/aligner/archform/matches` — every aligner set (linked or not) with its patient, for the picker and the linked map
  - `PATCH /api/aligner/sets/:setId/archform` — save/clear a match
  - `PUT /api/aligner/archform/patients/:id` — edit patient name in Archform DB
  - `DELETE /api/aligner/archform/patients/:id` — cascading delete patient + all related data from Archform DB, clears the main-DB (`aligner_sets.archform_id`) references
- **Frontend page** (`ArchformMatcher.tsx`) — table with:
  - **Match/Unmatch**: "Choose set…" opens one set picker for that row (open works first)
  - **Sortable columns**: Name, Created, Modified (asc/desc toggle)
  - **Inline edit**: pencil icon to rename patient directly in Archform DB
  - **Auto-rename**: magic wand icon (matched patients only) — sets Archform Name to `FirstName LastName` and LastName to `Dr_DoctorName_SetSequence` using English name fields from `patients`. Validates that English names exist and contain Latin characters; shows warning if not.
  - **Delete**: trash icon with confirmation dialog, cascading delete of all related Archform data
  - **Filter**: by name text and match status (matched/unmatched)
- **4th toggle button** ("Archform Match") in the aligner section nav, route at `/aligner/archform-match`

## Setup

Archform is optional per install. With no `ARCHFORM_DB_PATH` the matcher tab is hidden and
`/aligner/archform-match` says how to set it up; there is **no built-in default path** (it used to
fall back to this clinic's `\\workPC\…` share on every install — audit FE-F18-4).
`npm run db:setup` creates the row empty so it appears in Settings → General.

### Configuration

Set `ARCHFORM_DB_PATH` in Settings → General to the Archform database file (`__ARCHFORMDB`,
under the Archform user's `AppData\Local\Archform\` on the machine that runs Archform, shared on
the LAN):
- **Windows server** (production): the UNC path, e.g. `\\<archform-pc>\Archform\__ARCHFORMDB`.
- **WSL dev box**: the same UNC value works — `archform-db.ts` converts a stored `\\host\share\…`
  to `/mnt/<host>/<share>/…` (lower-cased host), so the share must be mounted there.

### Mounting the share on the WSL dev box

The dev box runs on WSL, so it reaches the share through a CIFS mount. The mount is **not
persistent** — remount after a restart or when the Archform PC's IP changes. WSL cannot resolve
NetBIOS names, so use the IP (`ipconfig` on that machine). **Credentials go in a root-only
credentials file, never in this repo:**

```bash
# /root/.smb-archform (chmod 600):  username=<user>\npassword=<password>
sudo mount -t cifs //<archform-pc-ip>/Archform /mnt/<host>/Archform \
  -o credentials=/root/.smb-archform,uid=$(id -u),gid=$(id -g),file_mode=0777,dir_mode=0777,vers=3.1.1,nobrl,cache=none
```

- **`nobrl`** — disables CIFS byte-range locks. Without this, SQLite commits fail with `SQLITE_BUSY` because CIFS cannot properly handle SQLite's lock promotion (RESERVED → EXCLUSIVE).
- **`cache=none`** — ensures fresh reads, no stale CIFS cache.
- **`uid`/`gid`** — the user the Node.js process runs as, so it has write access (without this, the mount defaults to root-owned with 0755 permissions → `SQLITE_READONLY`).

> An earlier version of this file carried the share's username and password in plain text. If
> that password is still in use on the Archform PC, change it — it remains in the git history.

## Matching rules

- A set is linked by `aligner_sets.archform_id`. The server refuses (409) to link a set that is
  already linked to a different Archform patient, or an Archform patient already linked to
  another set — unmatch first (FE-F18-3).
- A set whose Archform patient was deleted or merged **in Archform** keeps a dangling id; the
  matcher lists those above the table with an **Unmatch** button.
- Renaming an Archform patient that no longer exists answers 404 (it used to report success).

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
- The main DB's `aligner_sets.archform_id` references are cleared **before** the SQLite delete.

## Protocol Handler (Open in Archform)

A teal "Archform" button appears on set cards when `ArchformID` is matched. Clicking it triggers `archformlocal:{id}` which:

1. **C# handler** (`protocol-handlers/source/ArchformProtocolHandler.cs`) parses the ID, writes it as REG_DWORD to `HKCU\Software\ArchForm\ArchForm\LastPatient_h2457475196`
2. Launches `archform.exe` (path from `ProtocolHandlers.ini` → `ArchformPath`)
3. Archform reads the registry value on startup and opens that patient

**Why `archformlocal:` instead of `archform:`?** Archform registers its own `archform:` protocol for cloud-synced patients (downloads from AWS). Overwriting it breaks Archform's cloud features. Our handler only opens local patients (via registry key + direct exe launch), so it uses a separate `archformlocal:` protocol to avoid conflicts.

Install via `INSTALL.bat` (option 5). Optional `ArchformAllowedComputer` restricts to a single machine.

## Dependencies

- `better-sqlite3` + `@types/better-sqlite3`
