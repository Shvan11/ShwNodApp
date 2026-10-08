/**
 * Read-only viewer for a patient's images in Dolphin's shared `working/` gallery,
 * filtered to THIS patient: the 8 rendered photo views of every session AND the
 * images the 8-cell grid has no place for (a Dolphin OPG, a ceph, …). Grouped by
 * session in the photos page's order; `?tp=N` shows one session (the photos page's
 * "also in Dolphin" chip and the session kebab open it that way).
 *
 * Reuses the file-explorer tile + preview (via an injected working-files URL
 * builder), so it looks and behaves like the Files page minus all mutation.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { WorkingFileEntry } from '@shared/contracts/file-explorer.contract';
import { slotLabel } from '@shared/photo-views';
import { timepointsQuery, workingFilesQuery } from '@/query/queries';
import { useLastPhotoTab } from '@/hooks/useLastPhotoTab';
import { buildWorkingContentUrl } from './fileHelpers';
import { compareSlots } from './workingImages';
import { httpErrorMessage } from '@/core/http';
import FileEntryTile from './FileEntryTile';
import FilePreviewModal from './FilePreviewModal';
import explorer from './FileExplorer.module.css';
import styles from './WorkingFilesView.module.css';

interface Props {
  personId?: number | null;
}

interface SessionGroup {
  tpCode: string;
  title: string;
  entries: WorkingFileEntry[];
}

const noop = (): void => {};

/** 'YYYY-MM-DD' → 'DD-MM-YYYY', as the session tabs show it. */
const tabDate = (date: string): string => date.substring(0, 10).split('-').reverse().join('-');

const WorkingFilesView = ({ personId }: Props) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const onlyTp = searchParams.get('tp');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    ...workingFilesQuery(personId ?? ''),
    enabled: !!personId,
  });
  const { data: timepoints } = useQuery({ ...timepointsQuery(personId ?? ''), enabled: !!personId });
  const loading = !!personId && isLoading;
  const error = queryError ? httpErrorMessage(queryError, 'Failed to load working files') : null;

  // Sessions in the photos page's order (by date); a session's images in grid order,
  // then the slots the grid has no place for.
  const bySession = new Map<string, WorkingFileEntry[]>();
  for (const entry of data?.entries ?? []) {
    const key = String(entry.tpCode);
    const list = bySession.get(key);
    if (list) list.push(entry);
    else bySession.set(key, [entry]);
  }
  const sessionOrder = [
    ...(timepoints ?? []).map((tp) => tp.tp_code),
    ...[...bySession.keys()].sort((a, b) => Number(a) - Number(b)),
  ].filter((code, i, all) => all.indexOf(code) === i);
  const groups: SessionGroup[] = sessionOrder
    .filter((code) => bySession.has(code) && (onlyTp === null || code === onlyTp))
    .map((code) => {
      const tp = timepoints?.find((t) => t.tp_code === code);
      return {
        tpCode: code,
        title: tp ? `${tp.tp_description} · ${tabDate(tp.tp_date_time)}` : `Session ${code}`,
        entries: (bySession.get(code) ?? []).sort((a, b) => compareSlots(a.view, b.view)),
      };
    });
  // One preview sequence across every group on screen.
  const visible = groups.flatMap((g) => g.entries);
  const titleByPath = new Map(
    groups.flatMap((g) => g.entries.map((e) => [e.relPath, `${slotLabel(e.view)} — ${g.title} (${e.name})`] as const))
  );

  const onlySession = onlyTp === null ? null : timepoints?.find((tp) => tp.tp_code === onlyTp);
  // "Photos" returns to the session the user came from: the one last open on the
  // photos page (what the sidebar's Photos button reopens too), else the one shown
  // here. Not `?tp` alone: widening to every session drops it, and a bare /photos
  // lands on tp0, which most patients don't have. A deleted session is skipped.
  const lastPhotoTab = useLastPhotoTab(personId);
  const backTp =
    [lastPhotoTab, onlyTp].find(
      (code) => code !== null && (!timepoints || timepoints.some((tp) => tp.tp_code === code))
    ) ?? null;
  const showAll = () => {
    setPreviewIndex(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('tp');
        return next;
      },
      { replace: true }
    );
  };

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
          onClick={() => navigate(`/patient/${personId}/photos${backTp !== null ? `/tp${backTp}` : ''}`)}
        >
          <i className="fas fa-chevron-left" aria-hidden="true" /> Photos
        </button>
        <span className={explorer.crumbWrap}>
          <i className="fas fa-chevron-right" aria-hidden="true" />
          {onlyTp !== null ? (
            <button type="button" className={explorer.crumb} onClick={showAll}>
              <i className="fas fa-images" aria-hidden="true" /> Working files
            </button>
          ) : (
            <span className={explorer.crumbCurrent}>
              <i className="fas fa-images" aria-hidden="true" /> Working files
            </span>
          )}
        </span>
        {onlyTp !== null && (
          <span className={explorer.crumbWrap}>
            <i className="fas fa-chevron-right" aria-hidden="true" />
            <span className={explorer.crumbCurrent}>
              {onlySession
                ? `${onlySession.tp_description} · ${tabDate(onlySession.tp_date_time)}`
                : `Session ${onlyTp}`}
            </span>
          </span>
        )}
        {!loading && !error && visible.length > 0 && (
          <span className={styles.count}>{visible.length} image(s)</span>
        )}
      </nav>

      <div className={explorer.scrollArea}>
        {loading && <div className={explorer.message}>Loading…</div>}
        {error && !loading && (
          <div className={explorer.error}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" /> {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className={explorer.message}>
            {onlyTp !== null ? 'No images in this session.' : 'No working images for this patient yet.'}
          </div>
        )}
        {!loading &&
          !error &&
          groups.map((group) => (
            <section key={group.tpCode} className={styles.session} aria-label={group.title}>
              {/* A single session needs no heading: the breadcrumb already names it. */}
              {onlyTp === null && (
                <h3 className={styles.sessionTitle}>
                  {group.title}
                  <span className={styles.sessionCount}>{group.entries.length}</span>
                </h3>
              )}
              <div className={styles.grid}>
                {group.entries.map((entry) => (
                  <FileEntryTile
                    key={entry.relPath}
                    personId={personId}
                    entry={entry}
                    displayName={slotLabel(entry.view)}
                    view="grid"
                    readOnly
                    buildUrl={buildWorkingContentUrl}
                    onOpen={() => setPreviewIndex(visible.indexOf(entry))}
                    onRename={noop}
                    onDelete={noop}
                    onToggleSelect={noop}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>

      {previewIndex !== null && (
        <FilePreviewModal
          personId={personId}
          files={visible}
          startIndex={previewIndex}
          buildUrl={buildWorkingContentUrl}
          titleFor={(e) => titleByPath.get(e.relPath) ?? e.name}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
};

export default WorkingFilesView;
