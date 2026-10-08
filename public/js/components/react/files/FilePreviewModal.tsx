/**
 * Full-screen-ish preview overlay for a single file, with prev/next across the
 * current listing's files. Renders inline for image/video/audio/pdf/text and
 * offers a download CTA for everything else. Uses the shared <Modal>.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** The header's title for a file (default: its name). */
  titleFor?: (entry: FileEntry) => string;
  onClose: () => void;
}

const FilePreviewModal = ({
  personId,
  files,
  startIndex,
  buildUrl = buildContentUrl,
  titleFor = (e) => e.name,
  onClose,
}: Props) => {
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
      // Arrow keys aimed at a focused control (seeking a <video>, moving a caret)
      // must not also change the file (FE-F12-13c).
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('video, audio, input, textarea, select, [contenteditable="true"]')) return;
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
      {/* data-modal-drag-handle: scopes dragging to the header, so the previewed
          text file's content stays selectable (see Modal.tsx#handleDragPointerDown). */}
      <div className={styles.previewHeader} data-modal-drag-handle>
        <span id="file-preview-title" className={styles.previewTitle} title={entry.name}>
          {titleFor(entry)}
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

/** How much of a text file the preview shows. */
const TEXT_PREVIEW_BYTES = 200_000;

/**
 * The first {@link TEXT_PREVIEW_BYTES} of a text file, and no more. The preview used to
 * fetch the WHOLE file and then cut it (a 40 MB log → 40 MB over the tunnel to show
 * 200 KB), and its cleanup never aborted (FE-F12-14). A `Range` request asks for the
 * slice; the reader stops at the cap even if a server ignores the range.
 */
async function readTextHead(src: string, signal: AbortSignal): Promise<string> {
  // eslint-disable-next-line no-restricted-syntax -- raw file-content read (a byte range of a download URL, not a JSON API)
  const r = await fetch(src, {
    credentials: 'same-origin',
    headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
    signal,
  });
  if (!r.ok) throw new Error(String(r.status));
  if (!r.body) return (await r.text()).slice(0, TEXT_PREVIEW_BYTES);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let received = 0;
  while (received < TEXT_PREVIEW_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});
  return out.slice(0, TEXT_PREVIEW_BYTES);
}

/**
 * Video/audio whose download stops when it closes. An unmounted media element that
 * still holds its `src` keeps downloading until the file ends (FE-F11-13's mechanism).
 * The src is set in the effect, not as a prop, so dev StrictMode's setup → cleanup →
 * setup leaves it loaded (RC2's lesson).
 */
const MediaPreview = ({ kind, src }: { kind: 'video' | 'audio'; src: string }) => {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.src = src;
    void el.play().catch(() => {
      /* autoplay refused — the controls are there */
    });
    return () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [src]);
  return kind === 'video' ? (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied clinical videos have no caption track
    <video ref={ref} className={styles.previewMedia} controls />
  ) : (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied clinical recordings have no caption track
    <audio ref={ref} className={styles.previewAudio} controls />
  );
};

const PreviewBody = ({ entry, src, downloadUrl }: BodyProps) => {
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    if (entry.category !== 'text') return;
    const controller = new AbortController();
    readTextHead(src, controller.signal)
      .then((t) => {
        if (!controller.signal.aborted) setText(t);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTextError(true);
      });
    return () => controller.abort();
  }, [src, entry.category]);

  switch (entry.category) {
    case 'image':
      return <img className={styles.previewImage} src={src} alt={entry.name} />;
    case 'video':
      return <MediaPreview kind="video" src={src} />;
    case 'audio':
      return <MediaPreview kind="audio" src={src} />;
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
