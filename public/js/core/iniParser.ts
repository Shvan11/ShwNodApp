/**
 * INI File Parser Utility
 * Client-side parsing and formatting of INI configuration files
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** INI section with key-value pairs */
export interface IniSection {
  [key: string]: string;
}

/** Complete INI configuration */
export interface IniConfig {
  [section: string]: IniSection;
}

/** Parse options */
export interface ParseOptions {
  /** Comment characters (default: ['#', ';']) */
  commentChars?: string[];
  /** Allow values with = character */
  allowMultipleEquals?: boolean;
}

/** Format options */
export interface FormatOptions {
  /** Include header comment */
  includeHeader?: boolean;
  /** Include timestamp */
  includeTimestamp?: boolean;
  /** Custom header lines */
  headerLines?: string[];
  /** Section comments */
  sectionComments?: Record<string, string>;
  /** Key comments */
  keyComments?: Record<string, string>;
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse INI content string into structured object
 */
export function parseIniContent(
  content: string,
  options?: ParseOptions
): IniConfig {
  const config: IniConfig = {};
  let currentSection = '';
  const lines = content.split('\n');
  const commentChars = options?.commentChars ?? ['#', ';'];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || commentChars.some(char => trimmed.startsWith(char))) {
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

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format config object back to INI file content
 */
export function formatIniContent(
  config: IniConfig,
  options?: FormatOptions
): string {
  const lines: string[] = [];

  // Add header
  if (options?.includeHeader !== false) {
    if (options?.headerLines) {
      lines.push(...options.headerLines.map(line => `# ${line}`));
    } else {
      lines.push('# Protocol Handlers Configuration');
      lines.push('# Location: C:\\ShwanOrtho\\ProtocolHandlers.ini');
    }

    if (options?.includeTimestamp !== false) {
      lines.push(`# Last updated: ${new Date().toISOString()}`);
    }

    lines.push('');
  }

  // Add sections
  for (const [section, values] of Object.entries(config)) {
    lines.push(`[${section}]`);

    // Add section comment if provided
    const sectionComment = options?.sectionComments?.[section];
    if (sectionComment) {
      lines.push(`# ${sectionComment}`);
    }

    // Add key-value pairs
    for (const [key, value] of Object.entries(values)) {
      // Add key comment if provided
      const keyComment = options?.keyComments?.[key];
      if (keyComment) {
        lines.push(`# ${keyComment}`);
      }
      lines.push(`${key}=${value}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get default Protocol Handler format options
 */
export function getProtocolHandlerFormatOptions(): FormatOptions {
  return {
    includeHeader: true,
    includeTimestamp: true,
    headerLines: [
      'Protocol Handlers Configuration',
      'Location: C:\\ShwanOrtho\\ProtocolHandlers.ini'
    ],
    sectionComments: {
      Paths: 'Path configuration for protocol handlers'
    },
    keyComments: {
      UseRunAsDate: 'Set to true on PCs requiring RunAsDate workaround for Dolphin',
      RunAsDatePath: 'Full path to RunAsDate.exe utility'
    }
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Merge two INI configs (for pending changes)
 * Returns a new object without mutating inputs
 */
export function mergeConfigs(
  base: IniConfig,
  changes: Partial<IniConfig>
): IniConfig {
  const result: IniConfig = {};

  // Copy base config
  for (const [section, values] of Object.entries(base)) {
    result[section] = { ...values };
  }

  // Apply changes
  for (const [section, values] of Object.entries(changes)) {
    if (!result[section]) {
      result[section] = {};
    }
    if (values) {
      Object.assign(result[section], values);
    }
  }

  return result;
}

/**
 * Set a value in config (returns new object)
 */
export function setValue(
  config: IniConfig,
  section: string,
  key: string,
  value: string
): IniConfig {
  return {
    ...config,
    [section]: {
      ...config[section],
      [key]: value
    }
  };
}

// No `export default {…}`: its only consumer (ProtocolHandlersSettings) uses named
// imports, so the object was dead weight that nonetheless made 7 unused exports
// look used. Those went with it — validateIniConfig, getValue, removeKey,
// getSectionKeys, getSections, hasKey, countKeys (~110 lines).
