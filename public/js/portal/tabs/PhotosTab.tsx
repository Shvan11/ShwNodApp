import { useEffect, useMemo, useState } from 'react';
import type { PortalTimePoint, PortalPhoto } from '../portal.schemas';
import {
  portalTimepointsResponseSchema,
  portalPhotosResponseSchema,
} from '../portal.schemas';
import styles from '../portal.module.css';

function formatTpDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const PhotosTab = () => {
  const [tps, setTps] = useState<PortalTimePoint[] | null>(null);
  const [tpsError, setTpsError] = useState<string | null>(null);
  const [selectedTp, setSelectedTp] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PortalPhoto[] | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and reads res.ok/error.
        const res = await fetch('/api/portal/timepoints', { credentials: 'same-origin' });
        const parsed = portalTimepointsResponseSchema.safeParse(await res.json());
        if (cancelled) return;
        if (!res.ok || !parsed.success || !parsed.data.success || !parsed.data.timepoints) {
          setTpsError((parsed.success ? parsed.data.error : undefined) || 'Unable to load your photo history.');
          return;
        }
        const sorted = [...parsed.data.timepoints].sort(
          (a, b) => new Date(b.tp_date_time).getTime() - new Date(a.tp_date_time).getTime()
        );
        setTps(sorted);
        if (sorted.length > 0) setSelectedTp(sorted[0].tp_code);
      } catch {
        if (!cancelled) setTpsError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset the photo panel synchronously when the selected timepoint changes
  // (adjust-during-render keyed on selectedTp), so the async load below carries
  // only its post-await setStates and doesn't trip the setState-in-effect rule.
  const [loadingTp, setLoadingTp] = useState<string | null>(null);
  if (selectedTp && selectedTp !== loadingTp) {
    setLoadingTp(selectedTp);
    setPhotosLoading(true);
    setPhotos(null);
    setPhotosError(null);
  }

  useEffect(() => {
    if (!selectedTp) return;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and reads res.ok/error.
        const res = await fetch(`/api/portal/photos/${encodeURIComponent(selectedTp)}`, {
          credentials: 'same-origin',
        });
        const parsed = portalPhotosResponseSchema.safeParse(await res.json());
        if (cancelled) return;
        if (!res.ok || !parsed.success || !parsed.data.success || !parsed.data.photos) {
          setPhotosError((parsed.success ? parsed.data.error : undefined) || 'Unable to load photos.');
          return;
        }
        setPhotos(parsed.data.photos);
      } catch {
        if (!cancelled) setPhotosError('Unable to reach the server.');
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTp]);

  const tabList = useMemo(() => tps || [], [tps]);

  if (tpsError) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.errorBox}>{tpsError}</div>
      </div>
    );
  }

  if (!tps) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Loading photo history…</span>
        </div>
      </div>
    );
  }

  if (tabList.length === 0) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.emptyState}>
          <i className={`fas fa-camera ${styles.emptyIcon}`} aria-hidden="true" />
          <p>No photos have been shared yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabPanel}>
      <div className={styles.tpScroller}>
        {tabList.map((t) => (
          <button
            key={t.tp_code}
            type="button"
            className={
              t.tp_code === selectedTp
                ? `${styles.tpChip} ${styles.tpChipActive}`
                : styles.tpChip
            }
            onClick={() => setSelectedTp(t.tp_code)}
          >
            <div className={styles.tpChipDate}>{formatTpDate(t.tp_date_time)}</div>
            {t.tp_description && (
              <div className={styles.tpChipDesc}>{t.tp_description}</div>
            )}
          </button>
        ))}
      </div>

      {photosLoading && (
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Loading photos…</span>
        </div>
      )}
      {photosError && <div className={styles.errorBox}>{photosError}</div>}

      {photos && photos.length === 0 && (
        <div className={styles.emptyState}>
          <p>No photos are available for this visit.</p>
        </div>
      )}

      {photos && photos.length > 0 && (
        <div className={styles.photoGrid}>
          {photos.map((p, idx) => (
            <button
              key={p.name}
              type="button"
              className={styles.photoCell}
              onClick={() => setLightbox(idx)}
              aria-label={`View photo ${idx + 1}`}
            >
              <img
                src={`/DolImgs/${encodeURIComponent(p.name)}`}
                alt=""
                loading="lazy"
                className={styles.photoImg}
              />
            </button>
          ))}
        </div>
      )}

      {lightbox !== null && photos && photos[lightbox] && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            aria-label="Close"
            onClick={() => setLightbox(null)}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss */}
          <img
            src={`/DolImgs/${encodeURIComponent(photos[lightbox].name)}`}
            alt=""
            className={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default PhotosTab;
