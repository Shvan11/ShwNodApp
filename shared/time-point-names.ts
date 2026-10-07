/**
 * The photo-session (time point) names the product ships with.
 *
 * The clinic's own list lives in the `time_point_names` lookup table (Settings → Lookups,
 * or right-click the Name select), seeded with exactly these by
 * migrations/pg/1791294000000_time-point-names.sql — `fresh-install.test.ts` holds the two
 * together. The Name select falls back to this list while the lookup is unavailable or
 * empty, so a session can always be named.
 *
 * "P2" is the second phase of a two-phase treatment; "Final+" is a session taken after a
 * procedure that followed orthodontics (e.g. cosmetic work).
 *
 * Import-free on purpose: the React bundle (`@shared`) and the DB-less gate both read it.
 */
export const DEFAULT_TIME_POINT_NAMES = [
  'Initial',
  'Progress',
  'Final',
  'Initial P2',
  'Progress P2',
  'Final P2',
  'Final+',
  'Retention',
] as const;
