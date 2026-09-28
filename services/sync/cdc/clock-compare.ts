/**
 * Unified CDC — the pure half of the clock-alignment guard (see clock-check.ts for why it exists).
 * No database imports, so the comparison rules are unit-testable on their own.
 */

/** One clock: the zone it is configured with, and that zone's UTC offset at the moment of the check. */
export interface ClockReading {
  tz: string;
  offsetSec: number;
}

/** "UTC+03:00" / "UTC−04:30" — the offset is what actually decides a stamped value, not the name. */
export function formatOffset(offsetSec: number): string {
  const sign = offsetSec < 0 ? '-' : '+';
  const abs = Math.abs(offsetSec);
  const h = String(Math.floor(abs / 3600)).padStart(2, '0');
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

function describe(c: ClockReading): string {
  return `${c.tz} (${formatOffset(c.offsetSec)})`;
}

function gap(a: ClockReading, b: ClockReading): string {
  const hours = Math.abs(a.offsetSec - b.offsetSec) / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/**
 * Every disagreement between the clocks that write this schema's wall-clock timestamps, as
 * operator-facing sentences naming the fix. Empty when they agree.
 *
 * Compared by OFFSET, never by name: 'Asia/Baghdad' and 'Etc/GMT-3' stamp identical values, and a
 * name comparison would alarm on a harmless spelling.
 *
 * The app server's zone is the reference each database is judged against: it is the clinic's zone as
 * the app DECLARES it (config/process-env.ts, `TZ` on the service), and the one every stored value is
 * interpreted in. Judging the mirror against local instead would, on an install where local is the
 * misconfigured one, tell the operator to copy local's wrong zone onto the mirror. The mirror-vs-local
 * skew that reverse-sync last-write-wins compares is still named, on whichever message applies.
 */
export function compareClocks(
  node: ClockReading,
  local: ClockReading | null,
  mirror: ClockReading | null
): string[] {
  const out: string[] = [];
  const lwwSkew = !!local && !!mirror && local.offsetSec !== mirror.offsetSec;
  const lwwNote = lwwSkew && local && mirror
    ? `, and reverse-sync last-write-wins compares local and mirror stamps that are ${gap(local, mirror)} apart`
    : '';

  if (local && local.offsetSec !== node.offsetSec) {
    out.push(
      `Local PostgreSQL stamps ${describe(local)} but the app server runs ${describe(node)} — ` +
        `every database-stamped time reads ${gap(local, node)} off in the app${lwwNote}. ` +
        `Set \`timezone = '${node.tz}'\` in the local postgresql.conf and reload PostgreSQL.`
    );
  }
  if (mirror && mirror.offsetSec !== node.offsetSec) {
    // Name the LWW skew here only if the local message did not already carry it.
    const note = local && local.offsetSec !== node.offsetSec ? '' : lwwNote;
    out.push(
      `The Supabase mirror stamps ${describe(mirror)} but the app server runs ${describe(node)} — ` +
        `every portal-written time reads ${gap(mirror, node)} off${note}. ` +
        `Fix on the mirror: ALTER DATABASE postgres SET timezone TO '${node.tz}'; ` +
        `then recycle its sessions (docs/sync-cdc.md).`
    );
  }
  return out;
}
