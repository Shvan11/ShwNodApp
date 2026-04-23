import { useEffect, useMemo, useState } from 'react';
import styles from '../portal.module.css';

interface TimePoint {
  tpCode: string;
  tpDateTime: string;
  tpDescription: string;
}

interface Photo {
  name: string;
  width: number;
  height: number;
}

interface TpResponse {
  success: boolean;
  timepoints?: TimePoint[];
  error?: string;
}

interface PhotoResponse {
  success: boolean;
  photos?: Photo[];
  error?: string;
}

function formatTpDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const PhotosTab = () => {
  const [tps, setTps] = useState<TimePoint[] | null>(null);
  const [tpsError, setTpsError] = useState<string | null>(null);
  const [selectedTp, setSelectedTp] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/timepoints', { credentials: 'same-origin' });
        const data = (await res.json()) as TpResponse;
        if (cancelled) return;
        if (!res.ok || !data.success || !data.timepoints) {
          setTpsError(data.error || 'Unable to load your photo history.');
          return;
        }
        const sorted = [...data.timepoints].sort(
          (a, b) => new Date(b.tpDateTime).getTime() - new Date(a.tpDateTime).getTime()
        );
        setTps(sorted);
        if (sorted.length > 0) setSelectedTp(sorted[0].tpCode);
      } catch {
        if (!cancelled) setTpsError('Unable to reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedTp) return;
    let cancelled = false;
    setPhotosLoading(true);
    setPhotos(null);
    setPhotosError(null);
    (async () => {
      try {
        const res = await fetch(`/api/portal/photos/${encodeURIComponent(selectedTp)}`, {
          credentials: 'same-origin',
        });
        const data = (await res.json()) as PhotoResponse;
        if (cancelled) return;
        if (!res.ok || !data.success || !data.photos) {
          setPhotosError(data.error || 'Unable to load photos.');
          return;
        }
        setPhotos(data.photos);
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
            key={t.tpCode}
            type="button"
            className={
              t.tpCode === selectedTp
                ? `${styles.tpChip} ${styles.tpChipActive}`
                : styles.tpChip
            }
            onClick={() => setSelectedTp(t.tpCode)}
          >
            <div className={styles.tpChipDate}>{formatTpDate(t.tpDateTime)}</div>
            {t.tpDescription && (
              <div className={styles.tpChipDesc}>{t.tpDescription}</div>
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
                src={`/DolImgs/${p.name}`}
                alt={`Photo ${idx + 1}`}
                loading="lazy"
                className={styles.photoImg}
              />
            </button>
          ))}
        </div>
      )}

      {lightbox !== null && photos && photos[lightbox] && (
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
          <img
            src={`/DolImgs/${photos[lightbox].name}`}
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
