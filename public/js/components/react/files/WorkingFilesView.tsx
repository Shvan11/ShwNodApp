/**
 * Read-only viewer for a patient's rendered "working" view images — the cropped
 * `.iNN` files the photo editor writes to the shared `working/` folder, filtered
 * to THIS patient. Opened from the time-point kebab on the photos page.
 *
 * Reuses the file-explorer tile + preview (via an injected working-files URL
 * builder), so it looks and behaves like the Files page minus all mutation.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { FileEntry, FileListing } from '@/types/api.types';
import { workingFilesQuery } from '@/query/queries';
import { buildWorkingContentUrl, errorMessage } from './fileHelpers';
import FileEntryTile from './FileEntryTile';
import FilePreviewModal from './FilePreviewModal';
import explorer from './FileExplorer.module.css';
import styles from './WorkingFilesView.module.css';

interface Props {
  personId?: number | null;
}

const noop = (): void => {};

const WorkingFilesView = ({ personId }: Props) => {
  const navigate = useNavigate();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    ...workingFilesQuery(personId ?? ''),
    enabled: !!personId,
  });
  const loading = !!personId && isLoading;
  const error = queryError ? errorMessage(queryError, 'Failed to load working files') : null;

  // Stable order: by filename (timepoint then view), numeric-aware.
  const sorted = useMemo(() => {
    const entries = ((data as FileListing | undefined)?.entries ?? []) as FileEntry[];
    return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [data]);

  if (!personId) {
    return <div className={explorer.message}>No patient selected.</div>;
  }

  return (
    <div className={explorer.explorer}>
      {/* Header — mirrors the explorer breadcrumb, but this is a read-only view */}
      <nav className={explorer.breadcrumb} aria-label="Working files">
        <button
          type="button"
          className={explorer.crumb}
          onClick={() => navigate(`/patient/${personId}/photos`)}
        >
          <i className="fas fa-chevron-left" aria-hidden="true" /> Photos
        </button>
        <span className={explorer.crumbWrap}>
          <i className="fas fa-chevron-right" aria-hidden="true" />
          <span className={explorer.crumbCurrent}>
            <i className="fas fa-images" aria-hidden="true" /> Working files
          </span>
        </span>
        {!loading && !error && sorted.length > 0 && (
          <span className={styles.count}>{sorted.length} image(s)</span>
        )}
      </nav>

      <div className={explorer.scrollArea}>
        {loading && <div className={explorer.message}>Loading…</div>}
        {error && !loading && (
          <div className={explorer.error}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" /> {error}
          </div>
        )}
        {!loading && !error && sorted.length === 0 && (
          <div className={explorer.message}>No working images for this patient yet.</div>
        )}
        {!loading && !error && sorted.length > 0 && (
          <div className={styles.grid}>
            {sorted.map((entry, i) => (
              <FileEntryTile
                key={entry.relPath}
                personId={personId}
                entry={entry}
                view="grid"
                readOnly
                buildUrl={buildWorkingContentUrl}
                onOpen={() => setPreviewIndex(i)}
                onRename={noop}
                onDelete={noop}
                onToggleSelect={noop}
              />
            ))}
          </div>
        )}
      </div>

      {previewIndex !== null && (
        <FilePreviewModal
          personId={personId}
          files={sorted}
          startIndex={previewIndex}
          buildUrl={buildWorkingContentUrl}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
};

export default WorkingFilesView;
