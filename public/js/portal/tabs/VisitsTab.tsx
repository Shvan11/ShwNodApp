import { useEffect, useState } from 'react';
import type { PortalVisit } from '../portal.schemas';
import { portalVisitsResponseSchema } from '../portal.schemas';
import { portalGet } from '../portalApi';
import { formatLocaleDate } from '../../utils/formatters';
import styles from '../portal.module.css';

// English, like the rest of the portal's text — never the phone's own locale,
// which on an Arabic phone renders Arabic-Indic digits (audit FE-F3-3).
function formatVisitDate(iso: string): string {
  return formatLocaleDate(iso, { year: 'numeric', month: 'short', day: 'numeric' }) || iso;
}

// A visit is its date and what happened at it; the clinician's notes stay with the
// clinic (owner decision 2026-10-05, audit FE-F23-1). The list used to print the
// staff summary's HTML, tags and all.
function visitBadges(v: PortalVisit): { label: string; accent?: boolean }[] {
  const badges: { label: string; accent?: boolean }[] = [];
  if (v.opg) badges.push({ label: 'X-ray' });
  if (v.i_photo) badges.push({ label: 'Initial photos' });
  if (v.p_photo) badges.push({ label: 'Progress photos' });
  if (v.f_photo) badges.push({ label: 'Final photos' });
  if (v.appliance_removed) badges.push({ label: 'Appliance removed', accent: true });
  return badges;
}

const VisitsTab = () => {
  const [visits, setVisits] = useState<PortalVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await portalGet('/api/portal/visits', portalVisitsResponseSchema);
        if (cancelled) return;
        if (!result.ok || !result.data.visits) {
          setError((!result.ok && result.error) || 'Unable to load your visit history.');
          return;
        }
        setVisits(result.data.visits); // newest first, from the server
      } catch {
        if (!cancelled) setError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.errorBox}>{error}</div>
      </div>
    );
  }

  if (!visits) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Loading your visit history…</span>
        </div>
      </div>
    );
  }

  if (visits.length === 0) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.emptyState}>
          <i className={`fas fa-notes-medical ${styles.emptyIcon}`} aria-hidden="true" />
          <p>No visits recorded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabPanel}>
      <ul className={styles.visitList}>
        {visits.map((v) => {
          const badges = visitBadges(v);
          return (
            <li key={v.id} className={styles.visitItem}>
              <div className={styles.visitDate}>{formatVisitDate(v.visit_date)}</div>
              {badges.length > 0 && (
                <div className={styles.visitBadges}>
                  {badges.map((b) => (
                    <span
                      key={b.label}
                      className={b.accent ? `${styles.visitBadge} ${styles.visitBadgeAccent}` : styles.visitBadge}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default VisitsTab;
