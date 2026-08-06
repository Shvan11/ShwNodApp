// Type declarations for modules without TypeScript definitions

declare module 'connect-pg-simple' {
  import session from 'express-session';
  import type { Pool } from 'pg';

  interface PGStoreOptions {
    pool?: Pool;
    conString?: string;
    conObject?: object;
    pgPromise?: unknown;
    schemaName?: string;
    tableName?: string;
    createTableIfMissing?: boolean;
    ttl?: number;
    disableTouch?: boolean;
    pruneSessionInterval?: false | number;
    errorLog?: (...args: unknown[]) => void;
  }

  function connectPgSimple(session: typeof import('express-session')): {
    new (options?: PGStoreOptions): session.Store;
  };

  export = connectPgSimple;
}

