import { useEffect, useState } from 'react';
import type { PortalVisitSummary } from '../portal.schemas';
import { portalVisitsResponseSchema } from '../portal.schemas';
import styles from '../portal.module.css';

function formatVisitDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const VisitsTab = () => {
  const [visits, setVisits] = useState<PortalVisitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and reads res.ok/error.
        const res = await fetch('/api/portal/visits', { credentials: 'same-origin' });
        const parsed = portalVisitsResponseSchema.safeParse(await res.json());
        if (cancelled) return;
        if (!res.ok || !parsed.success || !parsed.data.success || !parsed.data.visits) {
          setError((parsed.success ? parsed.data.error : undefined) || 'Unable to load your visit history.');
          return;
        }
        const sorted = [...parsed.data.visits].sort(
          (a, b) => new Date(b.visit_date).getTime() - new Date(a.visit_date).getTime()
        );
        setVisits(sorted);
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
        {visits.map((v) => (
          <li key={v.id} className={styles.visitItem}>
            <div className={styles.visitDate}>{formatVisitDate(v.visit_date)}</div>
            {v.Summary && <div className={styles.visitSummary}>{v.Summary}</div>}
            <div className={styles.visitBadges}>
              {v.opg && <span className={styles.visitBadge}>OPG</span>}
              {v.i_photo && <span className={styles.visitBadge}>Photos</span>}
              {v.appliance_removed && (
                <span className={`${styles.visitBadge} ${styles.visitBadgeAccent}`}>
                  Appliance removed
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default VisitsTab;
