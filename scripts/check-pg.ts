/**
 * Phase 1 PostgreSQL connectivity check.
 * Connects via the app's Kysely pool (PG_* env vars) and prints db/user/version.
 *   npx tsx scripts/check-pg.ts
 */
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';

try {
  const { rows } = await sql<{ db: string; usr: string; ver: string }>`
    select current_database() as db, current_user as usr, version() as ver
  `.execute(getKysely());
  console.log('✅ PostgreSQL connectivity OK:', rows[0]);
  process.exit(0);
} catch (err) {
  console.error('❌ PostgreSQL connectivity FAILED:', (err as Error).message);
  process.exit(1);
}
