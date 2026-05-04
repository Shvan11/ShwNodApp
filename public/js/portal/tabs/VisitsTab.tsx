import { useEffect, useState } from 'react';
import type { PortalVisitSummary, PortalVisitsResponse } from '@/types/api.types';
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
        const res = await fetch('/api/portal/visits', { credentials: 'same-origin' });
        const data = (await res.json()) as PortalVisitsResponse;
        if (cancelled) return;
        if (!res.ok || !data.success || !data.visits) {
          setError(data.error || 'Unable to load your visit history.');
          return;
        }
        const sorted = [...data.visits].sort(
          (a, b) => new Date(b.VisitDate).getTime() - new Date(a.VisitDate).getTime()
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
          <li key={v.ID} className={styles.visitItem}>
            <div className={styles.visitDate}>{formatVisitDate(v.VisitDate)}</div>
            {v.Summary && <div className={styles.visitSummary}>{v.Summary}</div>}
            <div className={styles.visitBadges}>
              {v.OPG && <span className={styles.visitBadge}>OPG</span>}
              {v.IPhoto && <span className={styles.visitBadge}>Photos</span>}
              {v.ApplianceRemoved && (
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
