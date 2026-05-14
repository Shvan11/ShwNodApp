// services/config/DatabaseConfigService.ts
/**
 * Database Configuration Service
 * Manages database configuration through environment files and provides connection testing
 */

import EnvironmentManager, { DatabaseConfig, EnvironmentValidation, FileStatus } from './EnvironmentManager.js';
import sql from 'mssql';
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
      if (!includeSensitive && displayConfig.DB_PASSWORD) {
        displayConfig.DB_PASSWORD = '••••••••';
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

    const required: Array<keyof DatabaseConfig> = [
      'DB_SERVER',
      'DB_INSTANCE',
      'DB_DATABASE',
      'DB_USER',
      'DB_PASSWORD',
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

    const mssqlConfig: sql.config = {
      server: testConfig.DB_SERVER!,
      database: testConfig.DB_DATABASE,
      user: testConfig.DB_USER!,
      password: testConfig.DB_PASSWORD!,
      options: {
        instanceName: testConfig.DB_INSTANCE,
        encrypt: testConfig.DB_ENCRYPT === 'true',
        trustServerCertificate: testConfig.DB_TRUST_CERTIFICATE === 'true',
      },
      connectionTimeout: parseInt(testConfig.DB_CONNECTION_TIMEOUT || '30000'),
      requestTimeout: parseInt(testConfig.DB_REQUEST_TIMEOUT || '15000'),
      pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
    };

    log.info(`Testing database connection to ${testConfig.DB_SERVER}\\${testConfig.DB_INSTANCE}`);

    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await new sql.ConnectionPool(mssqlConfig).connect();
      const versionRow = await pool.request().query<{ version: string }>(
        "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64)) AS version"
      );
      const serverVersion = versionRow.recordset[0]?.version ?? 'Unknown';

      log.info('Database connection test successful');
      return {
        success: true,
        message: 'Connection successful',
        details: `Connected to ${testConfig.DB_SERVER}\\${testConfig.DB_INSTANCE}`,
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
      if (pool) {
        await pool.close().catch(() => {});
      }
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

    // Required fields
    const required: Array<{ field: keyof DatabaseConfig; name: string }> = [
      { field: 'DB_SERVER', name: 'Database Server' },
      { field: 'DB_INSTANCE', name: 'Instance Name' },
      { field: 'DB_DATABASE', name: 'Database Name' },
      { field: 'DB_USER', name: 'Username' },
      { field: 'DB_PASSWORD', name: 'Password' },
    ];

    for (const { field, name } of required) {
      if (!config[field] || config[field]!.trim() === '') {
        errors.push(`${name} is required`);
      }
    }

    // Validate boolean fields
    const booleanFields: Array<keyof DatabaseConfig> = ['DB_ENCRYPT', 'DB_TRUST_CERTIFICATE'];
    for (const field of booleanFields) {
      if (config[field] && !['true', 'false'].includes(config[field]!)) {
        errors.push(`${field} must be 'true' or 'false'`);
      }
    }

    // Validate numeric fields
    const numericFields: Array<keyof DatabaseConfig> = ['DB_CONNECTION_TIMEOUT', 'DB_REQUEST_TIMEOUT'];
    for (const field of numericFields) {
      if (config[field]) {
        const num = parseInt(config[field]!);
        if (isNaN(num) || num < 1000 || num > 300000) {
          errors.push(`${field} must be a number between 1000 and 300000`);
        }
      }
    }

    // Validate server name format
    if (config.DB_SERVER) {
      const serverName = config.DB_SERVER.trim();
      if (serverName.includes(' ') || serverName.length > 255) {
        errors.push('Server name contains invalid characters or is too long');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create backup of current configuration
   */
  async createBackup(): Promise<{ success: boolean; message: string; timestamp: string }> {
    try {
      const success = await this.envManager.createBackup();
      return {
        success,
        message: success
          ? 'Configuration backup created successfully'
          : 'No configuration file to backup',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create backup: ${(error as Error).message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(): Promise<ConfigUpdateResult> {
    try {
      await this.envManager.restoreFromBackup();
      return {
        success: true,
        message: 'Configuration restored from backup successfully',
        requiresRestart: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to restore from backup',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get configuration file status and diagnostics
   */
  async getConfigurationStatus(): Promise<ConfigStatus> {
    try {
      const fileStatus = await this.envManager.getFileStatus();
      const validation = await this.envManager.validateEnvironment();

      return {
        success: true,
        files: fileStatus,
        validation,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get configuration status',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Export current configuration (sanitized)
   */
  async exportConfiguration(): Promise<ConfigExportResult> {
    try {
      const config = await this.envManager.getDatabaseConfig();

      // Sanitize sensitive data
      const sanitizedConfig: DatabaseConfig = { ...config };
      sanitizedConfig.DB_PASSWORD = '••••••••';

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

  /**
   * Get database connection presets/templates
   */
  getConnectionPresets(): ConnectionPreset[] {
    return [
      {
        id: 'local_sqlexpress',
        name: 'Local SQL Server Express',
        description: 'Local SQL Server Express instance',
        config: {
          DB_SERVER: 'localhost',
          DB_INSTANCE: 'SQLEXPRESS',
          DB_DATABASE: 'ShwanNew',
          DB_USER: '',
          DB_PASSWORD: '',
          DB_ENCRYPT: 'false',
          DB_TRUST_CERTIFICATE: 'true',
        },
      },
      {
        id: 'clinic_dolphin',
        name: 'Clinic Dolphin Database',
        description: 'Main clinic database server',
        config: {
          DB_SERVER: 'CLINIC',
          DB_INSTANCE: 'DOLPHIN',
          DB_DATABASE: 'ShwanNew',
          DB_USER: 'Staff',
          DB_PASSWORD: '',
          DB_ENCRYPT: 'false',
          DB_TRUST_CERTIFICATE: 'true',
        },
      },
      {
        id: 'remote_secure',
        name: 'Remote Secure Connection',
        description: 'Remote database with encryption',
        config: {
          DB_SERVER: '',
          DB_INSTANCE: '',
          DB_DATABASE: 'ShwanNew',
          DB_USER: '',
          DB_PASSWORD: '',
          DB_ENCRYPT: 'true',
          DB_TRUST_CERTIFICATE: 'false',
        },
      },
    ];
  }
}

export default DatabaseConfigService;
