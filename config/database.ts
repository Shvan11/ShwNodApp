/**
 * Database configuration and connection management
 */
import { Connection } from 'tedious';
import config from './config.js';

/**
 * Create a new database connection using the application config
 * @returns A new tedious Connection instance
 */
function createConnection(): Connection {
  return new Connection(config.database);
}

export { createConnection };
