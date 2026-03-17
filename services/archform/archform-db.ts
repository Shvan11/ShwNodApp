/**
 * Archform SQLite Database Service
 *
 * Provides access to the Archform aligner design software's SQLite database.
 * Used to cross-reference Archform patients with aligner sets in the main SQL Server database.
 *
 * The DB path is configurable via the ARCHFORM_DB_PATH option in tbloptions.
 * On Windows production: UNC paths (\\workPC\Archform\__ARCHFORMDB) work natively.
 * On WSL2 development: requires manual SMB mount at /mnt/archform/.
 */
import Database from 'better-sqlite3';
import fsSync from 'fs';
import { getOption } from '../database/queries/options-queries.js';
import ResourceManager from '../core/ResourceManager.js';
import { log } from '../../utils/logger.js';
import {
  getPlatformInfo,
  convertWindowsPathToWSL,
  convertWSLPathToWindows,
} from '../../utils/path-resolver.js';

// ==============================
// TYPE DEFINITIONS
// ==============================

export interface ArchformPatient {
  Id: number;
  Name: string;
  LastName: string;
  CreatedDate: string;
  LastModifiedDate: string | null;
}

// ==============================
// CUSTOM ERROR
// ==============================

export class ArchformDbUnavailableError extends Error {
  public readonly dbPath: string;
  constructor(dbPath: string) {
    super(
      `Archform database not found at: ${dbPath}. Ensure the file is accessible from this machine.`
    );
    this.name = 'ArchformDbUnavailableError';
    this.dbPath = dbPath;
  }
}

// ==============================
// STATE
// ==============================

/** Default UNC path for Windows production (hostname resolved via NetBIOS) */
const DEFAULT_WINDOWS_PATH = '\\\\workPC\\Archform\\__ARCHFORMDB';
/** Default mount path for WSL2 development */
const DEFAULT_WSL_PATH = '/mnt/archform/__ARCHFORMDB';

let db: Database.Database | null = null;
let currentPath: string | null = null;

// ==============================
// INTERNAL HELPERS
// ==============================

/**
 * Get the platform-appropriate default DB path
 */
function getDefaultDbPath(): string {
  const { platform } = getPlatformInfo();
  return platform === 'wsl' ? DEFAULT_WSL_PATH : DEFAULT_WINDOWS_PATH;
}

/**
 * Resolve the configured DB path from tbloptions, falling back to default.
 * Auto-converts between Windows UNC and WSL paths based on current platform.
 */
async function resolveDbPath(): Promise<string> {
  try {
    const configured = await getOption('ARCHFORM_DB_PATH');
    if (!configured) return getDefaultDbPath();

    const { platform } = getPlatformInfo();
    // Auto-convert if stored path doesn't match current platform
    if (platform === 'wsl' && configured.startsWith('\\\\')) {
      return convertWindowsPathToWSL(configured);
    }
    if (platform === 'windows' && configured.startsWith('/mnt/')) {
      return convertWSLPathToWindows(configured);
    }
    return configured;
  } catch (error) {
    log.warn('Failed to read ARCHFORM_DB_PATH from options, using default', {
      error: (error as Error).message,
    });
    return getDefaultDbPath();
  }
}

/**
 * Open (or re-open) the SQLite database
 */
function openDb(dbPath: string): Database.Database {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
    db = null;
  }

  log.info('Opening Archform SQLite database', { path: dbPath });
  db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  currentPath = dbPath;
  return db;
}

/**
 * Force-reconnect: close stale connection and open fresh.
 * Used when a write fails due to stale file descriptor (e.g. after SMB remount).
 */
async function reconnect(): Promise<Database.Database> {
  log.warn('Forcing Archform DB reconnect');
  db = null;
  currentPath = null;
  return getDb();
}

/**
 * Get or lazily initialize the database connection.
 * Re-opens if the configured path has changed.
 * Throws ArchformDbUnavailableError if the file is not accessible.
 */
async function getDb(): Promise<Database.Database> {
  const dbPath = await resolveDbPath();

  if (db && currentPath === dbPath) {
    // Verify the connection is still alive
    try {
      db.pragma('journal_mode');
    } catch {
      log.warn('Archform DB connection stale, reopening');
      db = null;
      currentPath = null;
    }
  }

  if (db && currentPath === dbPath) {
    return db;
  }

  // Check file exists before trying to open
  if (!fsSync.existsSync(dbPath)) {
    throw new ArchformDbUnavailableError(dbPath);
  }

  return openDb(dbPath);
}

// ==============================
// PUBLIC API
// ==============================

/**
 * Check if the Archform database is accessible
 */
export async function isArchformAvailable(): Promise<{
  available: boolean;
  path: string;
  error?: string;
}> {
  const dbPath = await resolveDbPath();
  try {
    fsSync.accessSync(dbPath, fsSync.constants.R_OK);
    return { available: true, path: dbPath };
  } catch (error) {
    return {
      available: false,
      path: dbPath,
      error: (error as Error).message,
    };
  }
}

/**
 * Get all patients from the Archform SQLite database
 */
export async function getArchformPatients(): Promise<ArchformPatient[]> {
  const database = await getDb();
  const rows = database
    .prepare('SELECT Id, Name, LastName, CreatedDate, LastModifiedDate FROM Patient ORDER BY Name, LastName')
    .all() as ArchformPatient[];
  return rows;
}

/**
 * Get a single Archform patient by ID
 */
export async function getArchformPatientById(id: number): Promise<ArchformPatient | undefined> {
  const database = await getDb();
  const row = database
    .prepare('SELECT Id, Name, LastName, CreatedDate, LastModifiedDate FROM Patient WHERE Id = ?')
    .get(id) as ArchformPatient | undefined;
  return row;
}

/**
 * Update an Archform patient's name.
 * Retries once with a fresh connection if the write fails (e.g. after SMB remount).
 */
export async function updateArchformPatient(id: number, name: string, lastName: string): Promise<void> {
  try {
    const database = await getDb();
    database.prepare('UPDATE Patient SET Name = ?, LastName = ? WHERE Id = ?').run(name, lastName, id);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_READONLY') {
      log.warn('Archform write failed, retrying with fresh connection', { code });
      const database = await reconnect();
      database.prepare('UPDATE Patient SET Name = ?, LastName = ? WHERE Id = ?').run(name, lastName, id);
    } else {
      throw error;
    }
  }
}

/**
 * Parse a packed int32LE blob: [count:int32LE, id1:int32LE, id2:int32LE, ...]
 * Used by Archform to store ToothIDs, PonticIDs, PonticV3IDs in ToothInfoSet.
 */
function parseIdBlob(blob: Buffer | null): number[] {
  if (!blob || blob.length < 4) return [];
  const count = blob.readInt32LE(0);
  if (count <= 0) return [];
  const ids: number[] = [];
  for (let i = 0; i < count && (i + 1) * 4 < blob.length; i++) {
    ids.push(blob.readInt32LE((i + 1) * 4));
  }
  return ids;
}

/**
 * Delete all data associated with a ToothInfoSet: ToothInfo, PonticInfo, PonticV3Info rows,
 * then the ToothInfoSet row itself.
 */
function deleteToothInfoSet(
  database: Database.Database,
  toothInfoSetId: number | null,
  deleted: string[]
): void {
  if (!isValidFk(toothInfoSetId)) return;

  const tis = database
    .prepare('SELECT ToothIDs, PonticIDs, PonticV3IDs FROM ToothInfoSet WHERE Id = ?')
    .get(toothInfoSetId) as { ToothIDs: Buffer | null; PonticIDs: Buffer | null; PonticV3IDs: Buffer | null } | undefined;

  if (!tis) return;

  // Delete referenced ToothInfo rows
  const toothIds = parseIdBlob(tis.ToothIDs);
  if (toothIds.length > 0) {
    const placeholders = toothIds.map(() => '?').join(',');
    const r = database.prepare(`DELETE FROM ToothInfo WHERE Id IN (${placeholders})`).run(...toothIds);
    if (r.changes > 0) deleted.push(`ToothInfo(${r.changes})`);
  }

  // Delete referenced PonticInfo rows
  const ponticIds = parseIdBlob(tis.PonticIDs);
  if (ponticIds.length > 0) {
    const placeholders = ponticIds.map(() => '?').join(',');
    const r = database.prepare(`DELETE FROM PonticInfo WHERE Id IN (${placeholders})`).run(...ponticIds);
    if (r.changes > 0) deleted.push(`PonticInfo(${r.changes})`);
  }

  // Delete referenced PonticV3Info rows
  const ponticV3Ids = parseIdBlob(tis.PonticV3IDs);
  if (ponticV3Ids.length > 0) {
    const placeholders = ponticV3Ids.map(() => '?').join(',');
    const r = database.prepare(`DELETE FROM PonticV3Info WHERE Id IN (${placeholders})`).run(...ponticV3Ids);
    if (r.changes > 0) deleted.push(`PonticV3Info(${r.changes})`);
  }

  // Delete the ToothInfoSet itself
  database.prepare('DELETE FROM ToothInfoSet WHERE Id = ?').run(toothInfoSetId);
  deleted.push('ToothInfoSet');
}

/**
 * Check if an FK value is a valid reference (not null, not a sentinel like 0 or -1).
 * Archform uses 0 and -1 as "not set" sentinels instead of NULL.
 */
function isValidFk(id: number | null): id is number {
  return id != null && id > 0;
}

/**
 * Helper to delete a row by Id from a table if the id is a valid reference.
 */
function deleteById(
  database: Database.Database,
  table: string,
  id: number | null,
  deleted: string[]
): void {
  if (!isValidFk(id)) return;
  const r = database.prepare(`DELETE FROM "${table}" WHERE Id = ?`).run(id);
  if (r.changes > 0) deleted.push(table);
}

/** Full Patient row with all FK columns needed for cascading delete */
interface PatientFullRow {
  Id: number;
  OriginalScanPairId: number | null;
  ScanPairId: number | null;
  MarkerSetId: number | null;
  SegmentedMeshesId: number | null;
  BoundaryCurvesId: number | null;
  UpperToothSetId: number | null;
  LowerToothSetId: number | null;
  GoalSetId: number | null;
}

/**
 * Delete an Archform patient and ALL related data from SQLite.
 *
 * Relationship tree (Patient owns references outward):
 *   Patient
 *   ├── ScanPair        (OriginalScanPairId, ScanPairId)
 *   ├── MarkerSet       (MarkerSetId)
 *   ├── SegmentedGumsTeeth (SegmentedMeshesId)
 *   ├── ToothBoundaryCurves (BoundaryCurvesId)
 *   ├── GoalSet         (GoalSetId)
 *   ├── ToothInfoSet    (UpperToothSetId)
 *   │   ├── ToothInfo[]    (packed int32LE blob: ToothIDs)
 *   │   ├── PonticInfo[]   (packed int32LE blob: PonticIDs)
 *   │   └── PonticV3Info[] (packed int32LE blob: PonticV3IDs)
 *   └── ToothInfoSet    (LowerToothSetId)
 *       ├── ToothInfo[]    (ToothIDs)
 *       ├── PonticInfo[]   (PonticIDs)
 *       └── PonticV3Info[] (PonticV3IDs)
 */
export async function deleteArchformPatient(id: number): Promise<{ deletedFromTables: string[] }> {
  let database: Database.Database;
  try {
    database = await getDb();
    // Test write access before starting the heavy transaction
    database.pragma('journal_mode');
  } catch {
    log.warn('Archform DB connection stale for delete, reconnecting');
    database = await reconnect();
  }

  const deleteTx = database.transaction(() => {
    // 1. Read the full patient row to get all FK references
    const patient = database
      .prepare(
        `SELECT Id, OriginalScanPairId, ScanPairId, MarkerSetId,
                SegmentedMeshesId, BoundaryCurvesId,
                UpperToothSetId, LowerToothSetId, GoalSetId
         FROM Patient WHERE Id = ?`
      )
      .get(id) as PatientFullRow | undefined;

    if (!patient) {
      throw new Error(`Patient with Id ${id} not found`);
    }

    const deleted: string[] = [];

    // 2. Delete ToothInfoSets and their deep children (ToothInfo, PonticInfo, PonticV3Info)
    //    Deduplicate: one patient (Id 78) has UpperToothSetId == LowerToothSetId
    deleteToothInfoSet(database, patient.UpperToothSetId, deleted);
    if (patient.LowerToothSetId !== patient.UpperToothSetId) {
      deleteToothInfoSet(database, patient.LowerToothSetId, deleted);
    }

    // 3. Delete direct child rows referenced by Patient
    //    isValidFk() inside deleteById skips sentinel values (0, -1) used by Archform
    deleteById(database, 'GoalSet', patient.GoalSetId, deleted);
    deleteById(database, 'ToothBoundaryCurves', patient.BoundaryCurvesId, deleted);
    deleteById(database, 'SegmentedGumsTeeth', patient.SegmentedMeshesId, deleted);
    deleteById(database, 'MarkerSet', patient.MarkerSetId, deleted);

    // ScanPairs - patient may reference two (original + current), avoid double-delete
    deleteById(database, 'ScanPair', patient.ScanPairId, deleted);
    if (isValidFk(patient.OriginalScanPairId) && patient.OriginalScanPairId !== patient.ScanPairId) {
      deleteById(database, 'ScanPair', patient.OriginalScanPairId, deleted);
    }

    // 4. Delete the patient row itself
    database.prepare('DELETE FROM Patient WHERE Id = ?').run(id);
    deleted.push('Patient');

    return deleted;
  });

  return { deletedFromTables: deleteTx() };
}

/**
 * Close the Archform SQLite database connection
 */
export function closeArchformDb(): void {
  if (db) {
    try {
      db.close();
      log.info('Archform SQLite database closed');
    } catch (error) {
      log.error('Error closing Archform database', { error: (error as Error).message });
    }
    db = null;
    currentPath = null;
  }
}

// ==============================
// RESOURCE MANAGER REGISTRATION
// ==============================

ResourceManager.register('archform-db', null, () => {
  closeArchformDb();
});
