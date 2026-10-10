/**
 * A quick look at a 3D scan — STL, PLY, or a ZIP of them: rotate, pan, zoom, close.
 *
 * Given several files (e.g. a set's upper and lower jaw), it opens on one and lists
 * the others as checkboxes: ticking one adds it to the same scene. Scanners export
 * the jaws in one coordinate system, so an upper and a lower ticked together sit in
 * occlusion — no alignment step.
 *
 * Generic: any screen opens it with same-origin file URLs. Render it keyed by the
 * opening file (`key={url}`) so another file is a fresh mount. three.js lives in
 * `scanScene.ts` and is imported only when a scan opens.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { formatSize } from '../files/fileHelpers';
import type { ScanView } from './scanScene';
import styles from './ScanViewerModal.module.css';

export interface ScanFile {
  /** Same-origin URL of the file's bytes (the session cookie rides along). Also its key. */
  url: string;
  name: string;
  /** Size in bytes, shown while the file downloads. */
  size?: number | null;
}

interface ScanViewerModalProps {
  files: ScanFile[];
  /** The file shown on open (index into `files`). */
  initialIndex?: number;
  onClose: () => void;
}

type FileStatus = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };

async function fetchScan(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  // eslint-disable-next-line no-restricted-syntax -- binary file read for the 3D viewer (an ArrayBuffer), not a JSON API call; GET, so no CSRF token
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) {
    let message = `The file could not be loaded (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not a JSON error body */
    }
    throw new Error(message);
  }
  return res.arrayBuffer();
}

const ScanViewerModal = ({ files, initialIndex = 0, onClose }: ScanViewerModalProps) => {
  const titleId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ScanView | null>(null);
  /** Starts a file's download → parse → add; set by the effect that owns the scene. */
  const loadRef = useRef<((file: ScanFile) => void) | null>(null);
  const [first] = useState<ScanFile | undefined>(() => files[initialIndex] ?? files[0]);
  const [status, setStatus] = useState<Record<string, FileStatus>>(() =>
    first ? { [first.url]: { state: 'loading' } } : {}
  );
  const [shown, setShown] = useState<Record<string, boolean>>(() => (first ? { [first.url]: true } : {}));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !first) return;
    const controller = new AbortController();
    let view: ScanView | null = null;
    // The three.js chunk downloads alongside the first file.
    const engine = import('./scanScene').then((scene) => {
      if (controller.signal.aborted) return null;
      view = scene.mountScanScene(host);
      viewRef.current = view;
      return scene;
    });

    const load = (file: ScanFile): void => {
      Promise.all([fetchScan(file.url, controller.signal), engine])
        .then(([bytes, scene]) => {
          if (controller.signal.aborted || !scene || !view) return;
          view.add(file.url, scene.parseScan(file.name, bytes));
          view.resetView();
          setStatus((prev) => ({ ...prev, [file.url]: { state: 'ready' } }));
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'The scan could not be shown.';
          setStatus((prev) => ({ ...prev, [file.url]: { state: 'error', message } }));
        });
    };
    loadRef.current = load;
    load(first);

    return () => {
      controller.abort();
      view?.dispose();
      viewRef.current = null;
      loadRef.current = null;
    };
  }, [first]);

  const toggle = (file: ScanFile): void => {
    const current = status[file.url];
    if (current?.state === 'loading') return;
    if (!current || current.state === 'error') {
      setStatus((prev) => ({ ...prev, [file.url]: { state: 'loading' } }));
      setShown((prev) => ({ ...prev, [file.url]: true }));
      loadRef.current?.(file);
      return;
    }
    const next = !shown[file.url];
    setShown((prev) => ({ ...prev, [file.url]: next }));
    viewRef.current?.setVisible(file.url, next);
  };

  const anyReady = files.some((f) => status[f.url]?.state === 'ready');
  const loading = files.find((f) => status[f.url]?.state === 'loading');
  const errors = files.flatMap((f) => {
    const s = status[f.url];
    return s?.state === 'error' ? [s.message] : [];
  });

  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={titleId} contentClassName={styles.modal}>
      <ModalHeader
        title={files.length > 1 ? '3D scans' : (first?.name ?? '3D scan')}
        titleId={titleId}
        icon={<i className="fas fa-cube" />}
        onClose={onClose}
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => viewRef.current?.resetView()}
            disabled={!anyReady}
          >
            <i className="fas fa-expand" aria-hidden="true" /> Reset view
          </button>
        }
      />

      {files.length > 1 && (
        <div className={styles.files} role="group" aria-label="Scans shown">
          {files.map((file) => {
            const fileStatus = status[file.url];
            return (
              <label key={file.url} className={styles.file}>
                <input
                  type="checkbox"
                  checked={!!shown[file.url] && fileStatus?.state !== 'error'}
                  disabled={fileStatus?.state === 'loading'}
                  onChange={() => toggle(file)}
                />
                {file.name}
                {fileStatus?.state === 'loading' && <i className="fas fa-spinner fa-spin" aria-hidden="true" />}
                {fileStatus?.state === 'error' && <i className="fas fa-triangle-exclamation" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      )}

      <div className={styles.stage}>
        {/* data-no-drag: a drag on the model rotates it, never the dialog. */}
        <div ref={hostRef} className={styles.canvasHost} data-no-drag role="img" aria-label="3D view of the scan" />
        {!anyReady && loading && (
          <div className={styles.overlay} role="status">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            Loading {loading.name}
            {loading.size ? ` (${formatSize(loading.size)})` : ''}…
          </div>
        )}
        {!anyReady && !loading && errors.length > 0 && (
          <div className={styles.overlay} role="alert">
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            {errors[0]}
          </div>
        )}
      </div>

      {anyReady && errors.length > 0 && (
        <p className={styles.error} role="alert">
          {errors.join(' ')}
        </p>
      )}
      <p className={styles.hint}>Drag to rotate · Right-drag to pan · Scroll to zoom</p>
    </Modal>
  );
};

export default ScanViewerModal;
