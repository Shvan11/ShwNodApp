/**
 * Transport-order guard for the chair-display beacons.
 *
 * Switching patient on a chair PC sends two independent `navigator.sendBeacon`
 * POSTs from one tab — `patient-cleared` (A) then `patient-loaded` (B). sendBeacon
 * guarantees delivery, not order, and the broadcaster orders by ARRIVAL; so when
 * the CLEAR lands second, the kiosk goes blank with patient B open at the chair
 * and stays blank (12 h replay TTL, no re-request) until staff navigate away and
 * back (frontend audit FE-F4-10).
 *
 * Each tab now tags its beacons with a random `src` and an increasing `seq`.
 * A beacon is dropped when the same tab already got a NEWER one through for that
 * chair. Beacons from different tabs/PCs keep arrival order — comparing their
 * counters would need synchronized clocks. A beacon without the pair (a build
 * from before this change, still cached in a tab) is always accepted.
 */

/** Distinct tabs remembered per chair; the oldest is forgotten past this. */
const MAX_SOURCES_PER_CHAIR = 32;

export class ChairBeaconOrder {
  private readonly lastSeq = new Map<string, Map<string, number>>();

  /** True when this beacon should be applied; records it as the newest from its tab. */
  accept(chairId: string, src: string | undefined, seq: number | undefined): boolean {
    if (!src || seq === undefined) return true;

    let bySource = this.lastSeq.get(chairId);
    if (!bySource) {
      bySource = new Map();
      this.lastSeq.set(chairId, bySource);
    }

    const previous = bySource.get(src);
    if (previous !== undefined && seq <= previous) return false;

    bySource.delete(src); // re-insert so Map order tracks recency
    bySource.set(src, seq);
    if (bySource.size > MAX_SOURCES_PER_CHAIR) {
      bySource.delete(bySource.keys().next().value as string);
    }
    return true;
  }
}

export const chairBeaconOrder = new ChairBeaconOrder();
