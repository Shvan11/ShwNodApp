// services/config/index.ts
/**
 * Configuration service exports
 */

export { default as EnvironmentManager } from './EnvironmentManager.js';
export type { DatabaseConfig, EnvironmentValidation, FileStatus } from './EnvironmentManager.js';

export { default as DatabaseConfigService } from './DatabaseConfigService.js';
export type {
  ConfigResult,
  ConnectionTestResult,
  ConfigUpdateResult,
  ConfigValidation,
  ConfigStatus,
  ConfigExportResult,
  ConnectionPreset,
} from './DatabaseConfigService.js';
