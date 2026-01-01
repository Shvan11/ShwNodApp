/**
 * SSL Configuration for HTTPS server
 * Manages SSL certificate paths and options for LAN use
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SSL options for HTTPS server
 */
export interface SSLOptions {
  key: Buffer;
  cert: Buffer;
}

/**
 * SSL configuration object
 */
interface SSLConfig {
  certPath: string;
  keyPath: string;
  getOptions(): SSLOptions | null;
  isAvailable(): boolean;
}

const sslConfig: SSLConfig = {
  // SSL certificate paths
  certPath: path.join(__dirname, '../ssl/cert.pem'),
  keyPath: path.join(__dirname, '../ssl/key.pem'),

  /**
   * Get SSL options for HTTPS server
   * @returns SSL options object or null if certificates not found
   */
  getOptions(): SSLOptions | null {
    try {
      return {
        key: fs.readFileSync(this.keyPath),
        cert: fs.readFileSync(this.certPath)
      };
    } catch (error) {
      const err = error as Error;
      log.error('SSL certificate files not found', { error: err.message });
      return null;
    }
  },

  /**
   * Check if SSL certificates exist
   * @returns true if both cert and key files exist
   */
  isAvailable(): boolean {
    try {
      return fs.existsSync(this.certPath) && fs.existsSync(this.keyPath);
    } catch {
      return false;
    }
  }
};

export default sslConfig;
