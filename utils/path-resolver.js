/**
 * Cross-platform path resolver for Windows/WSL compatibility
 * Converts Windows UNC paths to WSL mount paths and vice versa
 */
import path from 'path';
import os from 'os';

// Environment variable to force platform type (for easy switching)
// Set PLATFORM_TYPE to 'windows' or 'wsl' to override auto-detection
const FORCED_PLATFORM = process.env.PLATFORM_TYPE;

/**
 * Detect the current platform
 * @returns {string} 'windows' or 'wsl'
 */
function detectPlatform() {
  if (FORCED_PLATFORM) {
    return FORCED_PLATFORM.toLowerCase();
  }
  
  // Auto-detect based on OS and WSL environment
  if (os.platform() === 'linux' && process.env.WSL_DISTRO_NAME) {
    return 'wsl';
  }
  
  return os.platform() === 'win32' ? 'windows' : 'wsl';
}

/**
 * Convert Windows UNC path to WSL mount path
 * Example: \\SERVER\share\folder -> /mnt/server/share/folder
 * @param {string} windowsPath - Windows UNC path
 * @returns {string} WSL mount path
 */
function convertWindowsPathToWSL(windowsPath) {
  // Handle UNC paths (\\server\share\path)
  if (windowsPath.startsWith('\\\\')) {
    const pathWithoutPrefix = windowsPath.substring(2);
    const parts = pathWithoutPrefix.split('\\');
    const serverName = parts[0].toLowerCase();
    const remainingPath = parts.slice(1).join('/');
    return `/mnt/${serverName}/${remainingPath}`;
  }
  
  // Handle drive paths (C:\path)
  if (/^[A-Za-z]:/.test(windowsPath)) {
    const drive = windowsPath[0].toLowerCase();
    const remainingPath = windowsPath.substring(3).replace(/\\/g, '/');
    return `/mnt/${drive}/${remainingPath}`;
  }
  
  // Already a Unix-style path
  return windowsPath.replace(/\\/g, '/');
}

/**
 * Convert WSL mount path to Windows UNC path
 * Example: /mnt/server/share/folder -> \\SERVER\share\folder
 * @param {string} wslPath - WSL mount path
 * @returns {string} Windows UNC path
 */
function convertWSLPathToWindows(wslPath) {
  // Handle WSL mount paths (/mnt/server/...)
  if (wslPath.startsWith('/mnt/')) {
    const pathWithoutPrefix = wslPath.substring(5);
    const parts = pathWithoutPrefix.split('/');
    const serverOrDrive = parts[0];
    const remainingPath = parts.slice(1).join('\\');
    
    // Check if it's a drive letter
    if (serverOrDrive.length === 1 && /[a-z]/.test(serverOrDrive)) {
      return `${serverOrDrive.toUpperCase()}:\\${remainingPath}`;
    }
    
    // It's a server name
    return `\\\\${serverOrDrive}\\${remainingPath}`;
  }
  
  // Regular Unix path, convert to current drive
  return wslPath.replace(/\//g, '\\');
}

/**
 * Resolve path based on current platform
 * @param {string} basePath - Base machine path from environment
 * @param {string} relativePath - Relative path to append
 * @returns {string} Platform-appropriate full path
 */
export function resolvePath(basePath, relativePath = '') {
  const platform = detectPlatform();
  let fullPath;
  
  if (platform === 'wsl') {
    // Convert base path to WSL format if needed
    const wslBasePath = basePath.startsWith('\\\\') || /^[A-Za-z]:/.test(basePath)
      ? convertWindowsPathToWSL(basePath)
      : basePath;
    
    // Join with relative path using Unix separators
    const normalizedRelative = relativePath.replace(/\\/g, '/');
    fullPath = path.posix.join(wslBasePath, normalizedRelative);
  } else {
    // Windows format
    const windowsBasePath = basePath.startsWith('/mnt/')
      ? convertWSLPathToWindows(basePath)
      : basePath;
    
    // For UNC paths, construct manually to preserve double backslash
    if (windowsBasePath.startsWith('\\\\') || basePath.startsWith('\\\\')) {
      const normalizedRelative = relativePath.replace(/\//g, '\\');
      fullPath = `\\\\${windowsBasePath.replace(/^\\\\/, '')}\\${normalizedRelative}`;
    } else {
      const normalizedRelative = relativePath.replace(/\//g, '\\');
      fullPath = path.win32.join(windowsBasePath, normalizedRelative);
    }
  }
  
  return fullPath;
}

/**
 * Create a path resolver function bound to a specific base path
 * @param {string} basePath - Base machine path from configuration
 * @returns {function} Function that resolves relative paths
 */
export function createPathResolver(basePath) {
  return (relativePath = '') => resolvePath(basePath, relativePath);
}

/**
 * Get platform-specific path separator
 * @returns {string} Path separator for current platform
 */
export function getPathSeparator() {
  return detectPlatform() === 'wsl' ? '/' : '\\';
}

/**
 * Get current platform information
 * @returns {object} Platform detection info
 */
export function getPlatformInfo() {
  const detected = detectPlatform();
  return {
    platform: detected,
    forced: !!FORCED_PLATFORM,
    osType: os.platform(),
    isWSL: !!process.env.WSL_DISTRO_NAME
  };
}

export default {
  resolvePath,
  createPathResolver,
  getPathSeparator,
  getPlatformInfo,
  convertWindowsPathToWSL,
  convertWSLPathToWindows
};