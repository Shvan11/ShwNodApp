// services/settings/DatabaseConfigService.ts
/**
 * Database Configuration Service
 * Manages database configuration through environment files and provides connection testing
 */

import EnvironmentManager, {
  DatabaseConfig,
  DATABASE_FIELD_LABELS,
  REQUIRED_DATABASE_FIELDS,
} from './EnvironmentManager.js';
import pg from 'pg';
import { log } from '../../utils/logger.js';
import { MASKED_SECRET, isMaskedSecret } from '../../shared/masked-secret.js';

/**
 * Configuration result interface
 */
export interface ConfigResult {
  success: boolean;
  config?: DatabaseConfig | null;
  timestamp?: string;
  error?: string;
  message?: string;
}

/**
 * Connection test result interface
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details: string;
  duration: number;
  errorCode?: string;
  serverVersion?: string;
}

/**
 * Configuration update result interface
 */
export interface ConfigUpdateResult {
  success: boolean;
  message: string;
  config?: DatabaseConfig;
  requiresRestart?: boolean;
  timestamp?: string;
  errors?: string[];
  error?: string;
}

/**
 * Configuration validation result interface
 */
export interface ConfigValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Configuration export result interface
 */
export interface ConfigExportResult {
  success: boolean;
  message: string;
  config?: DatabaseConfig;
  exportDate?: string;
  version?: string;
  error?: string;
}

class DatabaseConfigService {
  private envManager: EnvironmentManager;

  constructor() {
    this.envManager = new EnvironmentManager();
  }

  /**
   * Read the stored configuration, masking the password unless the caller
   * explicitly asks for it. `exportConfiguration` was a second copy of this that
   * differed only in its envelope keys.
   */
  async getCurrentConfig(includeSensitive = false): Promise<ConfigResult> {
    try {
      const config = await this.envManager.getDatabaseConfig();

      const displayConfig = { ...config };
      if (!includeSensitive && displayConfig.PG_PASSWORD) {
        displayConfig.PG_PASSWORD = MASKED_SECRET;
      }

      return {
        success: true,
        config: displayConfig,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        config: null,
      };
    }
  }

  /**
   * Test database connection with provided configuration
   */
  async testConnection(testConfig: Partial<DatabaseConfig>): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    const missing = REQUIRED_DATABASE_FIELDS.filter(
      (field) => !testConfig[field] || testConfig[field]!.trim() === ''
    );

    if (missing.length > 0) {
      return {
        success: false,
        message: 'Missing required configuration',
        details: `Required fields: ${missing.join(', ')}`,
        duration: Date.now() - startTime,
      };
    }

    // The mask is a display artefact, never a credential — refuse it here too, so
    // the check does not depend on the client remembering to make it.
    if (isMaskedSecret(testConfig.PG_PASSWORD)) {
      return {
        success: false,
        message: 'Cannot test with masked password',
        details:
          'The stored password is hidden. Type the password to test the connection, or clear the field for trust/peer auth.',
        duration: Date.now() - startTime,
      };
    }

    const parsedPort = parseInt(testConfig.PG_PORT || '5432', 10);
    const port = Number.isFinite(parsedPort) ? parsedPort : 5432;
    const target = `${testConfig.PG_HOST}:${port}/${testConfig.PG_DATABASE}`;

    // Short-lived pool, isolated from the app's runtime pool, so a bad test config
    // can never poison the live connections.
    const pool = new pg.Pool({
      host: testConfig.PG_HOST,
      port,
      database: testConfig.PG_DATABASE,
      user: testConfig.PG_USER,
      password: testConfig.PG_PASSWORD || undefined,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
    });

    log.info(`Testing database connection to ${target}`);

    try {
      const result = await pool.query<{ version: string }>('SELECT version() AS version');
      const serverVersion = result.rows[0]?.version ?? 'Unknown';

      log.info('Database connection test successful');
      return {
        success: true,
        message: 'Connection successful',
        details: `Connected to ${target}`,
        serverVersion,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      log.error('Database connection test failed:', err.message);
      return {
        success: false,
        message: 'Connection failed',
        details: err.message,
        errorCode: err.code,
        duration: Date.now() - startTime,
      };
    } finally {
      await pool.end().catch(() => {});
    }
  }

  /**
   * Update database configuration
   */
  async updateConfiguration(newConfig: Partial<DatabaseConfig>): Promise<ConfigUpdateResult> {
    try {
      log.info('Updating database configuration...');

      // Validate configuration
      const validation = this.validateConfiguration(newConfig);
      if (!validation.valid) {
        return {
          success: false,
          message: 'Configuration validation failed',
          errors: validation.errors,
        };
      }

      // Update environment file
      const updatedConfig = await this.envManager.updateDatabaseConfig(newConfig);

      log.info('Database configuration updated successfully');

      return {
        success: true,
        message: 'Database configuration updated successfully',
        config: updatedConfig,
        requiresRestart: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      log.error('Failed to update database configuration:', { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        message: 'Configuration update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate database configuration
   */
  validateConfiguration(config: Partial<DatabaseConfig>): ConfigValidation {
    const errors: string[] = [];

    for (const field of REQUIRED_DATABASE_FIELDS) {
      if (!config[field] || config[field]!.trim() === '') {
        errors.push(`${DATABASE_FIELD_LABELS[field]} is required`);
      }
    }

    // Validate port
    if (config.PG_PORT) {
      const port = parseInt(config.PG_PORT, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push('PG_PORT must be a number between 1 and 65535');
      }
    }

    // Validate host format
    if (config.PG_HOST) {
      const host = config.PG_HOST.trim();
      if (host.includes(' ') || host.length > 255) {
        errors.push('Host contains invalid characters or is too long');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Export the current configuration, always sanitized.
   */
  async exportConfiguration(): Promise<ConfigExportResult> {
    const result = await this.getCurrentConfig(false);
    if (!result.success || !result.config) {
      return {
        success: false,
        message: 'Failed to export configuration',
        error: result.error,
      };
    }
    return {
      success: true,
      message: 'Configuration exported successfully',
      // getCurrentConfig only masks a NON-EMPTY password; force the mask here so an
      // exported file never reveals that the deployment uses trust/peer auth.
      config: { ...result.config, PG_PASSWORD: MASKED_SECRET },
      exportDate: new Date().toISOString(),
      version: '1.0',
    };
  }

}

export default DatabaseConfigService;
