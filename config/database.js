/**
 * Database configuration and connection management
 */
import { Connection } from 'tedious';
import config from './config.js';

// Create a connection pool or factory
function createConnection() {
  return new Connection(config.database);
}

export { createConnection };
