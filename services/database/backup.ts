// services/database/backup.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

/**
 * Database backup — spawns `pg_dump` against the local PostgreSQL database and exposes
 * the child process so a route can stream its stdout straight to an HTTP download.
 * Custom format (`-Fc`): compressed, restorable with `pg_restore`.
 *
 * Connection params come from `config.databasePg`; the binary from `config.pgDumpPath`
 * (PATH `pg_dump` by default, or an absolute path on Windows). The password is passed via
 * the PGPASSWORD env var — never on argv (which would leak in the OS process list). No shell
 * is used and no user input reaches the arguments, so there is no command-injection surface.
 * pg_dump takes an MVCC snapshot (ACCESS SHARE only), so it is safe to run during clinic hours
 * and does not interfere with CDC/sync.
 */

/** Timestamped backup filename in local clinic wall-clock: shwan-backup-YYYYMMDD-HHMMSS.dump */
export function backupFilename(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `shwan-backup-${stamp}.dump`;
}

/** Spawn `pg_dump -Fc` for the configured database. The caller streams `child.stdout`. */
export function spawnPgDump(): ChildProcessWithoutNullStreams {
  const c = config.databasePg;
  const args = [
    '-h', c.host,
    '-p', String(c.port),
    '-U', c.user,
    '-d', c.database,
    '-Fc', // custom compressed format (restore with pg_restore)
    '--no-password', // never block on an interactive password prompt
  ];
  log.info('Starting database backup (pg_dump)', { database: c.database, host: c.host });
  return spawn(config.pgDumpPath, args, {
    env: { ...process.env, PGPASSWORD: c.password },
    windowsHide: true,
  });
}
