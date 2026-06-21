import { type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import { threeShapeCasesQuery, threeShapeMediaQuery } from '@/query/queries';
import styles from './ThreeShapeScansView.module.css';

interface Props {
  personId?: number | null;
}

type Indication = { from: number | null; to: number | null; type: string | null; material: string | null };

/** "Crown 3", "Bridge 14–16" — type + tooth range (UNN) for one indication. */
const indicationLabel = (i: Indication): string => {
  const teeth = i.from == null ? '' : i.to != null && i.to !== i.from ? ` ${i.from}–${i.to}` : ` ${i.from}`;
  return `${i.type ?? 'Item'}${teeth}`;
};

/** Distinct indication types, for the card title (e.g. "Crown, Bridge"). */
const summarizeTypes = (inds: Indication[]): string | null => {
  const types = [...new Set(inds.map((i) => i.type).filter((t): t is string => !!t))];
  return types.length ? types.join(', ') : null;
};

/** Build the proxied download URL; the media id is already percent-encoded by 3Shape. */
const downloadHref = (mediaId: string, fileId: string | null): string =>
  `/api/threeshape/media/${mediaId}/download${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`;

/**
 * Patient "3D Scans" tab — reads the patient's 3Shape cases + media LIVE from the
 * Web Service (no local mirroring). Thumbnails/downloads are proxied through the
 * server (`/api/threeshape/...`); TRIOS surface scans aren't downloadable, so we
 * surface their Unite Cloud web-viewer link instead. A not-connected / unreachable
 * error surfaces a link to Settings → Integrations.
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
            {cases.map((c) => {
              const title = summarizeTypes(c.indications) ?? `Case ${c.id.slice(0, 8)}`;
              return (
                <div key={c.id} className={styles.card}>
                  <div className={styles.thumb}>
                    <img src={`/api/threeshape/cases/${c.id}/thumbnail`} alt={title} onError={hideBrokenThumb} />
                  </div>
                  <div className={styles.info}>
                    <div className={styles.name}>{title}</div>
                    {c.workflowStatus && (
                      <div className={styles.badges}>
                        <span className={styles.badge}>{c.workflowStatus}</span>
                      </div>
                    )}
                    {c.indications.length > 0 && (
                      <div className={styles.meta}>{c.indications.map(indicationLabel).join(' · ')}</div>
                    )}
                    {c.creationDate && <div className={styles.meta}>Created {formatDate(c.creationDate)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {media.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            <i className="fas fa-file-download" /> Files ({media.length})
          </h2>
          <div className={styles.grid}>
            {media.map((m) => {
              const title = m.files[0]?.name ?? m.mediaType ?? `Media ${m.id.slice(0, 8)}`;
              const subtitle = [m.mediaType, formatDate(m.captureDate)].filter(Boolean).join(' · ');
              return (
                <div key={m.id} className={styles.card}>
                  <div className={styles.thumb}>
                    <img src={`/api/threeshape/media/${m.id}/thumbnail`} alt={title} onError={hideBrokenThumb} />
                  </div>
                  <div className={styles.info}>
                    <div className={styles.name}>{title}</div>
                    {subtitle && <div className={styles.meta}>{subtitle}</div>}
                    {m.files.length > 0 ? (
                      m.files.map((f) => (
                        <a
                          key={f.id ?? f.name}
                          className={`btn btn-primary btn-sm ${styles.download}`}
                          href={downloadHref(m.id, f.id)}
                        >
                          <i className="fas fa-download" /> {m.files.length > 1 ? (f.name ?? 'Download') : 'Download'}
                        </a>
                      ))
                    ) : (
                      <a className={`btn btn-primary btn-sm ${styles.download}`} href={downloadHref(m.id, null)}>
                        <i className="fas fa-download" /> Download
                      </a>
                    )}
                    {m.uniteCloudLink && (
                      <a
                        className={`btn btn-secondary btn-sm ${styles.download}`}
                        href={m.uniteCloudLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <i className="fas fa-cloud" /> View in 3D
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default ThreeShapeScansView;
