import { type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { httpErrorMessage } from '@/core/http';
import { threeShapeCasesQuery, threeShapeMediaQuery } from '@/query/queries';
import styles from './ThreeShapeScansView.module.css';

interface Props {
  personId?: number | null;
}

/**
 * Patient "3D Scans" tab — reads the patient's 3Shape cases + media LIVE from the
 * Web Service (no local mirroring). Thumbnails/downloads are proxied through the
 * server (`/api/threeshape/...`). A not-connected / unreachable error surfaces a
 * link to Settings → Integrations.
 */
const ThreeShapeScansView = ({ personId }: Props) => {
  const enabled = !!personId;
  const casesQ = useQuery({ ...threeShapeCasesQuery(personId ?? ''), enabled });
  const mediaQ = useQuery({ ...threeShapeMediaQuery(personId ?? ''), enabled });

  const hideBrokenThumb = (e: SyntheticEvent<HTMLImageElement>): void => {
    e.currentTarget.style.visibility = 'hidden';
  };

  if (!personId) {
    return (
      <div className="no-data-message">
        <i className="fas fa-cube" />
        <h3>3D Scans</h3>
        <p>Save the patient first to view 3Shape scans.</p>
      </div>
    );
  }

  if (casesQ.isLoading || mediaQ.isLoading) {
    return (
      <div className="loading-spinner">
        <i className="fas fa-spinner fa-spin" />
        <span>Loading 3Shape scans…</span>
      </div>
    );
  }

  // Either query failing (not connected / workstation unreachable) → one notice.
  const error = casesQ.error ?? mediaQ.error;
  if (error) {
    return (
      <div className="error-message">
        <i className="fas fa-exclamation-triangle" />
        <span>{httpErrorMessage(error, 'Could not load 3Shape scans')}</span>
        <p>
          <Link to="/settings/integrations">Open Settings → Integrations</Link> to connect 3Shape.
        </p>
      </div>
    );
  }

  const cases = casesQ.data?.cases ?? [];
  const media = mediaQ.data?.media ?? [];

  if (cases.length === 0 && media.length === 0) {
    return (
      <div className="no-data-message">
        <i className="fas fa-cube" />
        <h3>No 3Shape Scans</h3>
        <p>No scans or cases found for this patient yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.component}>
      {cases.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            <i className="fas fa-folder-open" /> Cases ({cases.length})
          </h2>
          <div className={styles.grid}>
            {cases.map((c) => (
              <div key={c.id} className={styles.card}>
                <div className={styles.thumb}>
                  <img
                    src={`/api/threeshape/cases/${c.id}/thumbnail`}
                    alt={c.name ?? 'Case'}
                    onError={hideBrokenThumb}
                  />
                </div>
                <div className={styles.info}>
                  <div className={styles.name}>{c.name ?? `Case ${c.id}`}</div>
                  <div className={styles.badges}>
                    {c.isScanned && <span className={styles.badge}>Scanned</span>}
                    {c.isModelled && <span className={styles.badge}>Modelled</span>}
                  </div>
                  {c.itemNames.length > 0 && <div className={styles.meta}>{c.itemNames.join(', ')}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {media.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            <i className="fas fa-file-download" /> Files ({media.length})
          </h2>
          <div className={styles.grid}>
            {media.map((m) => (
              <div key={m.id} className={styles.card}>
                <div className={styles.thumb}>
                  <img
                    src={`/api/threeshape/media/${m.id}/thumbnail`}
                    alt={m.name ?? 'Media'}
                    onError={hideBrokenThumb}
                  />
                </div>
                <div className={styles.info}>
                  <div className={styles.name}>{m.name ?? m.fileName ?? `Media ${m.id}`}</div>
                  {m.type && <div className={styles.meta}>{m.type}</div>}
                  <a
                    className={`btn btn-primary btn-sm ${styles.download}`}
                    href={`/api/threeshape/media/${m.id}/download`}
                  >
                    <i className="fas fa-download" /> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default ThreeShapeScansView;
