// services/config/DatabaseConfigService.ts
/**
 * Database Configuration Service
 * Manages database configuration through environment files and provides connection testing
 */

import EnvironmentManager, { DatabaseConfig, EnvironmentValidation, FileStatus } from './EnvironmentManager.js';
import pg from 'pg';
import { log } from '../../utils/logger.js';

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
 * Configuration status interface
 */
export interface ConfigStatus {
  success: boolean;
  files?: FileStatus;
  validation?: EnvironmentValidation;
  timestamp?: string;
  message?: string;
  error?: string;
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

/**
 * Connection preset interface
 */
export interface ConnectionPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<DatabaseConfig>;
}

class DatabaseConfigService {
  private envManager: EnvironmentManager;

  constructor() {
    this.envManager = new EnvironmentManager();
  }

  /**
   * Get current database configuration (with masked password)
   */
  async getCurrentConfig(includeSensitive = false): Promise<ConfigResult> {
    try {
      const config = await this.envManager.getDatabaseConfig();

      const displayConfig = { ...config };
      if (!includeSensitive && displayConfig.PG_PASSWORD) {
        displayConfig.PG_PASSWORD = '••••••••';
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

    // PG_PASSWORD may be empty (trust/peer auth), so it is not required here.
    const required: Array<keyof DatabaseConfig> = [
      'PG_HOST',
      'PG_PORT',
      'PG_DATABASE',
      'PG_USER',
    ];
    const missing = required.filter(
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

    // Required fields (PG_PASSWORD may be empty for trust/peer auth)
    const required: Array<{ field: keyof DatabaseConfig; name: string }> = [
      { field: 'PG_HOST', name: 'Host' },
      { field: 'PG_PORT', name: 'Port' },
      { field: 'PG_DATABASE', name: 'Database Name' },
      { field: 'PG_USER', name: 'Username' },
    ];

    for (const { field, name } of required) {
      if (!config[field] || config[field]!.trim() === '') {
        errors.push(`${name} is required`);
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
   * Export current configuration (sanitized)
   */
  async exportConfiguration(): Promise<ConfigExportResult> {
    try {
      const config = await this.envManager.getDatabaseConfig();

      // Sanitize sensitive data
      const sanitizedConfig: DatabaseConfig = { ...config };
      sanitizedConfig.PG_PASSWORD = '••••••••';

      return {
        success: true,
        message: 'Configuration exported successfully',
        config: sanitizedConfig,
        exportDate: new Date().toISOString(),
        version: '1.0',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to export configuration',
        error: (error as Error).message,
      };
    }
  }

}

export default DatabaseConfigService;
