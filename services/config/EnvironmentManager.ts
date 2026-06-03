// services/config/EnvironmentManager.ts
/**
 * Environment Manager Service
 * Handles reading, writing, and managing .env configuration files
 */

import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';

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
 * Environment validation result interface
 */
export interface EnvironmentValidation {
  valid: boolean;
  message: string;
  missing?: string[];
  suggestions?: string[];
  config?: DatabaseConfig;
  error?: string;
}

/**
 * File status interface
 */
export interface FileStatus {
  envExists: boolean;
  backupExists: boolean;
  templateExists: boolean;
  envModified?: Date;
  envSize?: number;
  envError?: string;
  backupModified?: Date;
  backupSize?: number;
  backupError?: string;
}

class EnvironmentManager {
  private envPath: string;
  private backupPath: string;
  private templatePath: string;

  constructor() {
    this.envPath = path.join(process.cwd(), '.env');
    this.backupPath = path.join(process.cwd(), '.env.backup');
    this.templatePath = path.join(process.cwd(), '.env.template');
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
        let value = trimmed.substring(equalIndex + 1).trim();

        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        env[key] = value;
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
    const remaining = new Set(Object.keys(updates));
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
      if (!remaining.has(key)) return line;
      remaining.delete(key);
      return `${key}=${this.formatEnvValue(updates[key])}`;
    });

    for (const key of remaining) {
      out.push(`${key}=${this.formatEnvValue(updates[key])}`);
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
   * Create a backup of the current .env file
   */
  async createBackup(): Promise<boolean> {
    try {
      if (fs_sync.existsSync(this.envPath)) {
        await fs.copyFile(this.envPath, this.backupPath);
        log.info('Environment backup created successfully');
        return true;
      }
      return false;
    } catch (error) {
      log.error('Failed to create environment backup', { error: (error as Error).message });
      throw new Error(`Backup creation failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Restore .env file from backup
   */
  async restoreFromBackup(): Promise<boolean> {
    try {
      if (fs_sync.existsSync(this.backupPath)) {
        await fs.copyFile(this.backupPath, this.envPath);
        log.info('Environment restored from backup successfully');
        return true;
      }
      throw new Error('No backup file found');
    } catch (error) {
      log.error('Failed to restore from backup', { error: (error as Error).message });
      throw new Error(`Restore failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Write text to a path atomically: stage to a temp file on the SAME directory,
   * then rename into place. A crash mid-write can't truncate the live .env, and
   * staging on the same volume avoids EXDEV on a network-mounted filesystem.
   */
  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const dir = path.dirname(targetPath);
    const tmp = path.join(dir, `.env.tmp-${process.pid}-${Date.now()}`);
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, targetPath);
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
      // Validate required fields (PG_PASSWORD may be empty for trust/peer auth)
      const required: Array<keyof DatabaseConfig> = [
        'PG_HOST',
        'PG_PORT',
        'PG_DATABASE',
        'PG_USER',
      ];
      for (const field of required) {
        if (!dbConfig[field] || dbConfig[field]!.trim() === '') {
          throw new Error(`Required field ${field} is missing or empty`);
        }
      }

      // Prepare database-specific updates
      const dbUpdates: Record<string, string> = {};
      const validFields: Array<keyof DatabaseConfig> = [
        'PG_HOST',
        'PG_PORT',
        'PG_DATABASE',
        'PG_USER',
        'PG_PASSWORD',
      ];

      for (const field of validFields) {
        if (dbConfig[field] !== undefined) {
          dbUpdates[field] = dbConfig[field]!.toString().trim();
        }
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

  /**
   * Validate environment file exists and is readable
   */
  async validateEnvironment(): Promise<EnvironmentValidation> {
    try {
      const exists = fs_sync.existsSync(this.envPath);
      if (!exists) {
        return {
          valid: false,
          message: '.env file does not exist',
          suggestions: ['Create .env file from template', 'Initialize with default values'],
        };
      }

      const dbConfig = await this.getDatabaseConfig();

      // Check for required database fields
      const required: Array<keyof DatabaseConfig> = [
        'PG_HOST',
        'PG_PORT',
        'PG_DATABASE',
        'PG_USER',
      ];
      const missing = required.filter((field) => !dbConfig[field]);

      if (missing.length > 0) {
        return {
          valid: false,
          message: `Missing required database configuration: ${missing.join(', ')}`,
          missing,
          suggestions: ['Add missing database configuration fields'],
        };
      }

      return {
        valid: true,
        message: 'Environment configuration is valid',
        config: dbConfig,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Environment validation failed: ${(error as Error).message}`,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get configuration file status
   */
  async getFileStatus(): Promise<FileStatus> {
    const status: FileStatus = {
      envExists: fs_sync.existsSync(this.envPath),
      backupExists: fs_sync.existsSync(this.backupPath),
      templateExists: fs_sync.existsSync(this.templatePath),
    };

    if (status.envExists) {
      try {
        const stats = await fs.stat(this.envPath);
        status.envModified = stats.mtime;
        status.envSize = stats.size;
      } catch (error) {
        status.envError = (error as Error).message;
      }
    }

    if (status.backupExists) {
      try {
        const stats = await fs.stat(this.backupPath);
        status.backupModified = stats.mtime;
        status.backupSize = stats.size;
      } catch (error) {
        status.backupError = (error as Error).message;
      }
    }

    return status;
  }
}

export default EnvironmentManager;
