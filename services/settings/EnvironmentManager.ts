// services/settings/EnvironmentManager.ts
/**
 * Environment Manager Service
 * Handles reading, writing, and managing .env configuration files
 */

import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';
import { isMaskedSecret } from '../../shared/masked-secret.js';

/**
 * Database configuration interface (PostgreSQL / node-postgres).
 *
 * Keys mirror the PG_* environment variables the app boots from (see config/config.ts
 * and .env.example). The retired SQL Server DB_* keys are no longer modelled here.
 */
export interface DatabaseConfig {
  PG_HOST: string;
  PG_PORT: string;
  PG_DATABASE: string;
  PG_USER: string;
  PG_PASSWORD: string;
}

/**
 * Every PG_* key this manager owns. Single source for "which fields exist" —
 * previously spelled out separately in three places across two files.
 */
export const DATABASE_CONFIG_FIELDS: readonly (keyof DatabaseConfig)[] = [
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
  'PG_PASSWORD',
];

/**
 * Fields that must be non-empty. `PG_PASSWORD` is deliberately absent: trust/peer
 * auth is a valid configuration with no password at all.
 */
export const REQUIRED_DATABASE_FIELDS: readonly (keyof DatabaseConfig)[] = [
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
];

/** Human labels for the required fields, for user-facing validation messages. */
export const DATABASE_FIELD_LABELS: Record<keyof DatabaseConfig, string> = {
  PG_HOST: 'Host',
  PG_PORT: 'Port',
  PG_DATABASE: 'Database Name',
  PG_USER: 'Username',
  PG_PASSWORD: 'Password',
};

/**
 * Split a raw `.env` value from any trailing ` # comment`.
 *
 * A comment is only a comment when it follows whitespace and sits OUTSIDE quotes —
 * `PG_PASSWORD=a#b` is a password containing a hash, not a commented-out `a`.
 * Returns the value text and the comment (including its leading whitespace) so a
 * rewrite can put the comment back.
 */
export function splitEnvComment(raw: string): { value: string; comment: string } {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      // Take the WHITESPACE RUN before the '#' with the comment. Without it a
      // rewrite emits `PG_PORT=5432# default`, and `#` not preceded by whitespace
      // is no longer a comment — the next read would parse the comment text as
      // part of the port value.
      let start = i;
      while (start > 0 && /\s/.test(raw[start - 1])) start--;
      return { value: raw.slice(0, start), comment: raw.slice(start) };
    }
  }
  return { value: raw, comment: '' };
}

/** Strip a trailing comment and surrounding quotes from a raw `.env` value. */
function parseEnvValue(raw: string): string {
  let value = splitEnvComment(raw).value.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

/** How many timestamped `.env` snapshots to keep. */
const BACKUP_RETENTION = 10;

class EnvironmentManager {
  private envPath: string;
  private backupPath: string;

  constructor() {
    this.envPath = path.join(process.cwd(), '.env');
    this.backupPath = path.join(process.cwd(), '.env.backup');
  }

  /**
   * Read and parse the current .env file
   */
  async readEnvFile(): Promise<Record<string, string>> {
    try {
      const envContent = await fs.readFile(this.envPath, 'utf8');
      return this.parseEnvContent(envContent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.warn('No .env file found, returning empty configuration');
        return {};
      }
      throw new Error(`Failed to read .env file: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Parse environment file content into key-value pairs
   */
  parseEnvContent(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse key=value pairs
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        env[key] = parseEnvValue(trimmed.substring(equalIndex + 1));
      }
    }

    return env;
  }

  /**
   * Render a single value for the .env file, quoting only when necessary.
   */
  formatEnvValue(value: string): string {
    return this.shouldQuoteValue(value) ? `"${value}"` : value;
  }

  /**
   * Surgically apply key=value updates to raw .env text. Existing keys are edited
   * in place; comments, blank lines, ordering, and unrelated keys are preserved
   * verbatim; genuinely-new keys are appended at the end.
   *
   * Replaces the old whole-file re-render, which dropped every comment and
   * collapsed the documented multi-section layout into two alphabetized buckets
   * on every single-key save — mangling unrelated config on the live .env.
   */
  applyEnvUpdates(raw: string, updates: Record<string, string>): string {
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    const wanted = new Set(Object.keys(updates));
    const seen = new Set<string>();
    const lines = raw.length ? raw.split(/\r?\n/) : [];

    // Drop a single trailing empty line (from the file's final newline) so appended
    // keys don't land after a blank gap; the trailing newline is re-added on join.
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    const out = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line; // comment / blank — verbatim
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return line;
      const key = trimmed.substring(0, eq).trim();
      if (!wanted.has(key)) return line;
      // Rewrite EVERY occurrence, not just the first. A hand-edited .env can carry
      // the same key twice, and dotenv honours the LAST one — stopping at the first
      // match wrote the new value into a line the loader then ignores, so the save
      // silently did nothing.
      seen.add(key);
      // Carry any trailing ` # comment` across. Rewriting the whole line deleted
      // the documentation next to every key the settings form ever touched.
      const { comment } = splitEnvComment(trimmed.substring(eq + 1));
      return `${key}=${this.formatEnvValue(updates[key])}${comment}`;
    });

    for (const key of wanted) {
      if (!seen.has(key)) out.push(`${key}=${this.formatEnvValue(updates[key])}`);
    }

    return out.join(newline) + newline;
  }

  /**
   * Determine if a value should be quoted in .env file
   */
  shouldQuoteValue(value: string): boolean {
    if (typeof value !== 'string') return false;

    // Quote if contains spaces, special characters, or is empty
    return (
      value.includes(' ') ||
      value.includes('\t') ||
      value.includes('\n') ||
      value.includes('#') ||
      value.includes('=') ||
      value === ''
    );
  }

  /**
   * Snapshot the current .env before a write.
   *
   * Backups are TIMESTAMPED and the newest `BACKUP_RETENTION` kept. A single
   * fixed `.env.backup` was overwritten on every save, so two consecutive bad
   * saves destroyed the last good copy — exactly when it is needed. `.env.backup`
   * is still written as the newest snapshot so existing recovery notes hold.
   */
  async createBackup(): Promise<boolean> {
    try {
      if (!fs_sync.existsSync(this.envPath)) return false;

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(this.envPath, `${this.backupPath}.${stamp}`);
      await fs.copyFile(this.envPath, this.backupPath);
      await this.pruneBackups();

      log.info('Environment backup created successfully');
      return true;
    } catch (error) {
      log.error('Failed to create environment backup', { error: (error as Error).message });
      throw new Error(`Backup creation failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /** Delete all but the newest BACKUP_RETENTION timestamped snapshots. */
  private async pruneBackups(): Promise<void> {
    const dir = path.dirname(this.backupPath);
    const prefix = `${path.basename(this.backupPath)}.`;
    try {
      const entries = await fs.readdir(dir);
      const stale = entries
        .filter((name) => name.startsWith(prefix))
        .sort()               // ISO timestamps sort chronologically
        .slice(0, -BACKUP_RETENTION);
      await Promise.all(
        stale.map((name) => fs.unlink(path.join(dir, name)).catch(() => {}))
      );
    } catch (error) {
      // Pruning is housekeeping — never fail a config save over it.
      log.warn('Could not prune .env backups', { error: (error as Error).message });
    }
  }

  /**
   * Write text to a path atomically: stage to a temp file on the SAME directory,
   * then rename into place. A crash mid-write can't truncate the live .env, and
   * staging on the same volume avoids EXDEV on a network-mounted filesystem.
   *
   * The temp file is created 0600 and the destination's existing mode is re-applied
   * after the rename: .env holds the DB password, and a default-umask temp file
   * would silently widen its permissions on every save.
   */
  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const dir = path.dirname(targetPath);
    const tmp = path.join(dir, `.env.tmp-${process.pid}-${Date.now()}`);

    let priorMode: number | null = null;
    try {
      priorMode = (await fs.stat(targetPath)).mode & 0o777;
    } catch {
      // First write — no prior file to inherit a mode from.
    }

    await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, targetPath);

    if (priorMode !== null && priorMode !== 0o600) {
      // chmod is a no-op on Windows for anything but the read-only bit; harmless.
      await fs.chmod(targetPath, priorMode).catch(() => {});
    }
  }

  /**
   * Update specific environment variables in place, preserving the rest of the
   * file (comments, sections, ordering, untouched keys). Written atomically.
   */
  async updateEnvVars(
    updates: Record<string, string>,
    createBackup = true
  ): Promise<Record<string, string>> {
    try {
      if (createBackup) {
        await this.createBackup();
      }

      // Read the raw text (the file may not exist yet on a first write).
      let raw = '';
      try {
        raw = await fs.readFile(this.envPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      const newText = this.applyEnvUpdates(raw, updates);
      await this.atomicWrite(this.envPath, newText);

      log.info('Environment file updated successfully', { keys: Object.keys(updates) });
      return this.parseEnvContent(newText);
    } catch (error) {
      log.error('Failed to update environment variables', { error: (error as Error).message });
      throw new Error(`Update failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Get database configuration from environment
   */
  async getDatabaseConfig(): Promise<DatabaseConfig> {
    try {
      const env = await this.readEnvFile();

      return {
        PG_HOST: env.PG_HOST || 'localhost',
        PG_PORT: env.PG_PORT || '5432',
        PG_DATABASE: env.PG_DATABASE || 'shwan_test',
        PG_USER: env.PG_USER || 'shwan_app',
        PG_PASSWORD: env.PG_PASSWORD || '',
      };
    } catch (error) {
      log.error('Failed to get database configuration', { error: (error as Error).message });
      throw new Error(`Database config read failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Update database configuration
   */
  async updateDatabaseConfig(dbConfig: Partial<DatabaseConfig>): Promise<DatabaseConfig> {
    try {
      for (const field of REQUIRED_DATABASE_FIELDS) {
        if (!dbConfig[field] || dbConfig[field]!.trim() === '') {
          throw new Error(`Required field ${field} is missing or empty`);
        }
      }

      const dbUpdates: Record<string, string> = {};
      for (const field of DATABASE_CONFIG_FIELDS) {
        const value = dbConfig[field];
        if (value === undefined) continue;
        // The form renders the stored password as a mask and posts the whole
        // config back, so an untouched password field arrives as the mask itself.
        // Writing it would set the literal bullet characters as the real
        // PostgreSQL password and lock the app out at the next restart. Treat it
        // as "unchanged" and leave the stored value alone.
        if (isMaskedSecret(value)) {
          log.info('Ignoring masked secret on config save — keeping stored value', { field });
          continue;
        }
        dbUpdates[field] = value.toString().trim();
      }

      // Update environment
      await this.updateEnvVars(dbUpdates, true);

      // Return only database configuration
      return this.getDatabaseConfig();
    } catch (error) {
      log.error('Failed to update database configuration', { error: (error as Error).message });
      throw new Error(`Database config update failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

export default EnvironmentManager;
