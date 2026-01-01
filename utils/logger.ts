/**
 * Winston Logger Configuration
 *
 * Provides structured logging with different levels and transports.
 * Replaces console.log/console.error statements for better production logging.
 *
 * Log Levels (in order of priority):
 * - error: Error messages and exceptions
 * - warn: Warning messages
 * - info: Informational messages (default)
 * - http: HTTP request logs
 * - verbose: Verbose informational messages
 * - debug: Debug messages (development only)
 * - silly: Very detailed debug messages
 */

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'shwan-orthodontics' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

/**
 * Log metadata type - accepts any serializable object or primitive values
 * Using object allows interfaces without index signatures to be passed
 * Includes unknown to support passing caught errors directly in strict mode
 */
export type LogMeta = object | string | number | boolean | null | undefined | unknown;

/**
 * Convenience methods that match console API
 */
export interface LogMethods {
  error: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  http: (message: string, meta?: LogMeta) => void;
  verbose: (message: string, meta?: LogMeta) => void;
  debug: (message: string, meta?: LogMeta) => void;
  log: (message: string, meta?: LogMeta) => void;
}

// Create convenience methods that match console API
export const log: LogMethods = {
  error: (message: string, meta: LogMeta = {}) => logger.error(message, meta),
  warn: (message: string, meta: LogMeta = {}) => logger.warn(message, meta),
  info: (message: string, meta: LogMeta = {}) => logger.info(message, meta),
  http: (message: string, meta: LogMeta = {}) => logger.http(message, meta),
  verbose: (message: string, meta: LogMeta = {}) => logger.verbose(message, meta),
  debug: (message: string, meta: LogMeta = {}) => logger.debug(message, meta),

  // Aliases for common console methods
  log: (message: string, meta: LogMeta = {}) => logger.info(message, meta),
};

// Export the winston logger instance for advanced usage
export default logger;
