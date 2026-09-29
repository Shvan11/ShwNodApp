import { type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import { threeShapeCasesQuery, threeShapeMediaQuery } from '@/query/queries';
import { useGlobalState } from '@/contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { unnToPalmer } from '@/utils/toothNotation';
import styles from './ThreeShapeScansView.module.css';

interface Props {
  personId?: number | null;
}

type Indication = { from: number | null; to: number | null; type: string | null; material: string | null };

/** A 3Shape (UNN) tooth number in the app's own notation; an unmappable value stays visibly UNN. */
const tooth = (unn: number): string => unnToPalmer(unn) ?? `UNN ${unn}`;

/** One indication's teeth — "UR6", "UL6–UL8" — or `null` when it names none. */
const indicationTeeth = (i: Indication, notation: (n: number) => string): string | null => {
  if (i.from == null) return null;
  return i.to != null && i.to !== i.from ? `${notation(i.from)}–${notation(i.to)}` : notation(i.from);
};

/**
 * "Crown UR6", "Bridge UL6–UL8" — type + teeth for one indication. 3Shape sends
 * UNN integers; printing them raw ("Bridge 14–16") read as FDI puts the bridge on
 * the other side of the mouth, so they are shown in the app's Palmer-style
 * notation (FE-F9-6). The raw UNN rides in the tooltip for cross-checking in Unite.
 */
const indicationLabel = (i: Indication): string => {
  const teeth = indicationTeeth(i, tooth);
  return `${i.type ?? 'Item'}${teeth ? ` ${teeth}` : ''}`;
};

const indicationUnnTitle = (inds: Indication[]): string =>
  inds
    .map((i) => indicationTeeth(i, String))
    .filter((t): t is string => !!t)
    .map((t) => `UNN ${t}`)
    .join(' · ');

/** Distinct indication types, for the card title (e.g. "Crown, Bridge"). */
const summarizeTypes = (inds: Indication[]): string | null => {
  const types = [...new Set(inds.map((i) => i.type).filter((t): t is string => !!t))];
  return types.length ? types.join(', ') : null;
};

/**
 * Build the proxied download URL; the media id is already percent-encoded by 3Shape.
 * The links carry `download`, so a failed download (workstation off, 3Shape
 * disconnected) shows up as a failed download instead of navigating this SPA tab
 * to the raw JSON error (FE-F9-14).
 */
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
  // Settings → Integrations is an admin-only tab; only an admin can act on the link.
  const { user } = useGlobalState();
  const canConnect = roleCaps(user?.role as UserRole | undefined).adminWrites;
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
        {canConnect ? (
          <p>
            <Link to="/settings/integrations">Open Settings → Integrations</Link> to connect 3Shape.
          </p>
        ) : (
          <p>Ask an administrator to check the 3Shape connection in Settings → Integrations.</p>
        )}
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
                      <div className={styles.meta} title={indicationUnnTitle(c.indications)}>
                        {c.indications.map(indicationLabel).join(' · ')}
                      </div>
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
                          download
                        >
                          <i className="fas fa-download" /> {m.files.length > 1 ? (f.name ?? 'Download') : 'Download'}
                        </a>
                      ))
                    ) : (
                      <a className={`btn btn-primary btn-sm ${styles.download}`} href={downloadHref(m.id, null)} download>
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
