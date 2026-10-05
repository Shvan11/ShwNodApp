import { useEffect, useMemo, useRef, useState } from 'react';
import type { PortalTimePoint, PortalPhoto } from '../portal.schemas';
import {
  portalTimepointsResponseSchema,
  portalPhotosResponseSchema,
} from '../portal.schemas';
import { portalGet } from '../portalApi';
import { formatLocaleDate } from '../../utils/formatters';
import styles from '../portal.module.css';

// English, like the rest of the portal's text — never the phone's own locale,
// which on an Arabic phone renders Arabic-Indic digits (audit FE-F3-3).
function formatTpDate(iso: string): string {
  return formatLocaleDate(iso, { year: 'numeric', month: 'short', day: 'numeric' }) || iso;
}

// Portal images are served by the authenticated /api/portal/photos/:tp/:name
// route (NOT the staff-only /DolImgs static mount, which a patient session can't
// reach — it redirects to the staff login and the <img> renders blank).
//
// The grid loads `?size=thumb` (a light 480px WebP) so a phone isn't pulling a
// gridful of 13–18 MP originals over the tunnel; the lightbox loads the full-res
// original. Same thumb-grid / full-on-click split as the staff GridComponent.
function photoSrc(tp: string, name: string, size?: 'thumb'): string {
  const base = `/api/portal/photos/${encodeURIComponent(tp)}/${encodeURIComponent(name)}`;
  return size === 'thumb' ? `${base}?size=thumb` : base;
}

/** Close the lightbox through its history entry when it has one (→ popstate closes it). */
function leaveLightbox(close: () => void): void {
  if ((window.history.state as { portalLightbox?: boolean } | null)?.portalLightbox) {
    window.history.back();
  } else {
    close();
  }
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
        const result = await portalGet('/api/portal/timepoints', portalTimepointsResponseSchema);
        if (cancelled) return;
        if (!result.ok || !result.data.timepoints) {
          setTpsError((!result.ok && result.error) || 'Unable to load your photo history.');
          return;
        }
        const sorted = [...result.data.timepoints].sort(
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
        const result = await portalGet(
          `/api/portal/photos/${encodeURIComponent(selectedTp)}`,
          portalPhotosResponseSchema
        );
        if (cancelled) return;
        if (!result.ok || !result.data.photos) {
          setPhotosError((!result.ok && result.error) || 'Unable to load photos.');
          return;
        }
        setPhotos(result.data.photos);
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

  // ── Lightbox (FE-F23-12) ── Opening pushes a history entry, so the phone's Back
  // gesture closes the photo instead of leaving the portal; every other way out
  // (✕, backdrop, Escape) goes back through that entry, so the two never drift.
  // Focus moves to ✕ on open and returns to the thumbnail on close.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openPhoto = (idx: number, opener: HTMLElement) => {
    openerRef.current = opener;
    window.history.pushState({ portalLightbox: true }, '');
    setLightbox(idx);
  };
  const closePhoto = () => leaveLightbox(() => setLightbox(null));
  useEffect(() => {
    const onPop = () => setLightbox(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const isOpen = lightbox !== null;
  useEffect(() => {
    if (!isOpen) {
      openerRef.current?.focus();
      return;
    }
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leaveLightbox(() => setLightbox(null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

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

      {selectedTp && photos && photos.length > 0 && (
        <div className={styles.photoGrid}>
          {photos.map((p, idx) => (
            <button
              key={p.name}
              type="button"
              className={styles.photoCell}
              onClick={(e) => openPhoto(idx, e.currentTarget)}
              aria-label={`View photo ${idx + 1}`}
            >
              <img
                src={photoSrc(selectedTp, p.name, 'thumb')}
                alt=""
                loading="lazy"
                className={styles.photoImg}
              />
            </button>
          ))}
        </div>
      )}

      {selectedTp && lightbox !== null && photos && photos[lightbox] && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${lightbox + 1} of ${photos.length}`}
          onClick={closePhoto}
        >
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.lightboxClose}
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              closePhoto();
            }}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss */}
          <img
            src={photoSrc(selectedTp, photos[lightbox].name)}
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
