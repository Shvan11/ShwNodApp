/**
 * Full-screen-ish preview overlay for a single file, with prev/next across the
 * current listing's files. Renders inline for image/video/audio/pdf/text and
 * offers a download CTA for everything else. Uses the shared <Modal>.
 */
import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/react/Modal';
import type { FileEntry } from '@/types/api.types';
import { buildContentUrl, type ContentUrlOptions } from './fileHelpers';
import styles from './FileExplorer.module.css';

type UrlBuilder = (personId: number, relPath: string, opts?: ContentUrlOptions) => string;

interface Props {
  personId: number;
  files: FileEntry[];
  startIndex: number;
  /** Override how content/download URLs are built (default: patient files). */
  buildUrl?: UrlBuilder;
  onClose: () => void;
}

const FilePreviewModal = ({ personId, files, startIndex, buildUrl = buildContentUrl, onClose }: Props) => {
  const [index, setIndex] = useState(startIndex);
  const entry = files[index];

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => (i < files.length - 1 ? i + 1 : i));
  }, [files.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext]);

  if (!entry) return null;

  const src = buildUrl(personId, entry.relPath);
  const downloadUrl = buildUrl(personId, entry.relPath, { download: true });

  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy="file-preview-title" contentClassName={styles.previewModal}>
      <div className={styles.previewHeader}>
        <span id="file-preview-title" className={styles.previewTitle} title={entry.name}>
          {entry.name}
        </span>
        <div className={styles.previewHeaderActions}>
          <a className={styles.iconButton} href={downloadUrl} title="Download" aria-label="Download">
            <i className="fas fa-download" aria-hidden="true" />
          </a>
          <button type="button" className={styles.iconButton} onClick={onClose} title="Close" aria-label="Close">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.previewBody}>
        {files.length > 1 && (
          <button
            type="button"
            className={`${styles.navArrow} ${styles.navPrev}`}
            onClick={goPrev}
            disabled={index === 0}
            aria-label="Previous"
          >
            <i className="fas fa-chevron-left" aria-hidden="true" />
          </button>
        )}

        <PreviewBody key={entry.relPath} personId={personId} entry={entry} src={src} downloadUrl={downloadUrl} />

        {files.length > 1 && (
          <button
            type="button"
            className={`${styles.navArrow} ${styles.navNext}`}
            onClick={goNext}
            disabled={index === files.length - 1}
            aria-label="Next"
          >
            <i className="fas fa-chevron-right" aria-hidden="true" />
          </button>
        )}
      </div>

      {files.length > 1 && (
        <div className={styles.previewFooter}>
          {index + 1} / {files.length}
        </div>
      )}
    </Modal>
  );
};

interface BodyProps {
  personId: number;
  entry: FileEntry;
  src: string;
  downloadUrl: string;
}

const PreviewBody = ({ entry, src, downloadUrl }: BodyProps) => {
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    if (entry.category !== 'text') return;
    let cancelled = false;
    // eslint-disable-next-line no-restricted-syntax -- raw file-content fetch (reads res.text() of a download URL, not a JSON API)
    fetch(src, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!cancelled) setText(t.slice(0, 200_000)); // guard huge files
      })
      .catch(() => {
        if (!cancelled) setTextError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, entry.category]);

  switch (entry.category) {
    case 'image':
      return <img className={styles.previewImage} src={src} alt={entry.name} />;
    case 'video':
      // eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied clinical videos have no caption track
      return <video className={styles.previewMedia} src={src} controls autoPlay />;
    case 'audio':
      // eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied clinical videos have no caption track
      return <audio className={styles.previewAudio} src={src} controls autoPlay />;
    case 'pdf':
      return <iframe className={styles.previewFrame} src={src} title={entry.name} />;
    case 'text':
      if (textError) return <DownloadFallback name={entry.name} downloadUrl={downloadUrl} />;
      return <pre className={styles.previewText}>{text ?? 'Loading…'}</pre>;
    default:
      return <DownloadFallback name={entry.name} downloadUrl={downloadUrl} />;
  }
};

const DownloadFallback = ({ name, downloadUrl }: { name: string; downloadUrl: string }) => (
  <div className={styles.previewFallback}>
    <i className="fas fa-circle-down" aria-hidden="true" />
    <p>No inline preview for this file type.</p>
    <a className={styles.primaryButton} href={downloadUrl}>
      Download {name}
    </a>
  </div>
);

export default FilePreviewModal;
