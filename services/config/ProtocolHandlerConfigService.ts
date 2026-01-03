// services/config/ProtocolHandlerConfigService.ts
/**
 * Protocol Handler Configuration Service
 * Manages reading and writing Windows INI configuration file for protocol handlers
 * File location: C:\Windows\ProtocolHandlers.ini
 */

import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';

/**
 * INI file section with key-value pairs
 */
export interface IniSection {
  [key: string]: string;
}

/**
 * Complete INI file structure
 */
export interface IniConfig {
  [section: string]: IniSection;
}

/**
 * Protocol handler configuration result
 */
export interface ConfigResult {
  success: boolean;
  config?: IniConfig;
  message?: string;
  error?: string;
  timestamp?: string;
}

/**
 * File status information
 */
export interface FileStatus {
  exists: boolean;
  backupExists: boolean;
  modified?: Date;
  size?: number;
  error?: string;
}

class ProtocolHandlerConfigService {
  private readonly configPath: string;
  private readonly backupPath: string;

  constructor() {
    // Windows path for the INI file
    this.configPath = 'C:\\Windows\\ProtocolHandlers.ini';
    this.backupPath = 'C:\\Windows\\ProtocolHandlers.ini.backup';
  }

  /**
   * Read and parse the INI file
   */
  async readConfig(): Promise<ConfigResult> {
    try {
      if (!fs_sync.existsSync(this.configPath)) {
        return {
          success: false,
          error: `Configuration file not found: ${this.configPath}`,
          message: 'The protocol handler configuration file does not exist.'
        };
      }

      const content = await fs.readFile(this.configPath, 'utf8');
      const config = this.parseIniContent(content);

      return {
        success: true,
        config,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      log.error('Failed to read protocol handler config', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        message: 'Failed to read configuration file. Check file permissions.'
      };
    }
  }

  /**
   * Parse INI file content into structured object
   */
  parseIniContent(content: string): IniConfig {
    const config: IniConfig = {};
    let currentSection = '';
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      // Section header [SectionName]
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
        if (!config[currentSection]) {
          config[currentSection] = {};
        }
        continue;
      }

      // Key=Value pair
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0 && currentSection) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();
        config[currentSection][key] = value;
      }
    }

    return config;
  }

  /**
   * Format config object back to INI file content
   */
  formatIniContent(config: IniConfig): string {
    const lines: string[] = [
      '# Protocol Handlers Configuration',
      '# Location: C:\\Windows\\ProtocolHandlers.ini',
      `# Last updated: ${new Date().toISOString()}`,
      ''
    ];

    for (const [section, values] of Object.entries(config)) {
      lines.push(`[${section}]`);

      // Add section-specific comments
      if (section === 'Paths') {
        lines.push('# Path configuration for protocol handlers');
      } else if (section === 'Applications') {
        lines.push('# Application aliases for Universal Protocol (launch://)');
      }

      for (const [key, value] of Object.entries(values)) {
        // Add key-specific comments for important settings
        if (key === 'UseRunAsDate') {
          lines.push('# Set to true on PCs requiring RunAsDate workaround for Dolphin');
        } else if (key === 'RunAsDatePath') {
          lines.push('# Full path to RunAsDate.exe utility');
        }
        lines.push(`${key}=${value}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Create a backup of the current configuration
   */
  async createBackup(): Promise<ConfigResult> {
    try {
      if (!fs_sync.existsSync(this.configPath)) {
        return {
          success: false,
          error: 'No configuration file to backup',
          message: 'Configuration file does not exist.'
        };
      }

      await fs.copyFile(this.configPath, this.backupPath);
      log.info('Protocol handler config backup created');

      return {
        success: true,
        message: 'Backup created successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      log.error('Failed to create backup', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        message: 'Failed to create backup. Check file permissions.'
      };
    }
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(): Promise<ConfigResult> {
    try {
      if (!fs_sync.existsSync(this.backupPath)) {
        return {
          success: false,
          error: 'No backup file found',
          message: 'Backup file does not exist.'
        };
      }

      await fs.copyFile(this.backupPath, this.configPath);
      log.info('Protocol handler config restored from backup');

      // Read and return the restored config
      return this.readConfig();
    } catch (error) {
      const errorMessage = (error as Error).message;
      log.error('Failed to restore from backup', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        message: 'Failed to restore from backup. Check file permissions.'
      };
    }
  }

  /**
   * Update configuration (creates backup first)
   */
  async updateConfig(newConfig: IniConfig): Promise<ConfigResult> {
    try {
      // Create backup first
      if (fs_sync.existsSync(this.configPath)) {
        const backupResult = await this.createBackup();
        if (!backupResult.success) {
          log.warn('Could not create backup before update', { error: backupResult.error });
        }
      }

      // Format and write new content
      const content = this.formatIniContent(newConfig);
      await fs.writeFile(this.configPath, content, 'utf8');

      log.info('Protocol handler config updated successfully');

      return {
        success: true,
        config: newConfig,
        message: 'Configuration saved successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      log.error('Failed to update protocol handler config', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        message: 'Failed to save configuration. Check file permissions (may need admin rights).'
      };
    }
  }

  /**
   * Update specific key in a section
   */
  async updateKey(section: string, key: string, value: string): Promise<ConfigResult> {
    try {
      const readResult = await this.readConfig();
      if (!readResult.success || !readResult.config) {
        return readResult;
      }

      const config = readResult.config;

      // Ensure section exists
      if (!config[section]) {
        config[section] = {};
      }

      config[section][key] = value;

      return this.updateConfig(config);
    } catch (error) {
      const errorMessage = (error as Error).message;
      return {
        success: false,
        error: errorMessage,
        message: 'Failed to update configuration key.'
      };
    }
  }

  /**
   * Get file status information
   */
  async getFileStatus(): Promise<FileStatus> {
    const status: FileStatus = {
      exists: fs_sync.existsSync(this.configPath),
      backupExists: fs_sync.existsSync(this.backupPath)
    };

    if (status.exists) {
      try {
        const stats = await fs.stat(this.configPath);
        status.modified = stats.mtime;
        status.size = stats.size;
      } catch (error) {
        status.error = (error as Error).message;
      }
    }

    return status;
  }

  /**
   * Get the paths being used
   */
  getPaths(): { configPath: string; backupPath: string } {
    return {
      configPath: this.configPath,
      backupPath: this.backupPath
    };
  }
}

export default ProtocolHandlerConfigService;
