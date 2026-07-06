/**
 * Native Dolphin-style photo layout manager (Phase 4). Drag originals from the
 * Sequence Files sidebar into the 8 view slots, frame each, then Save — the
 * server (sharp) renders working/{pid}0{tp}.iNN so the existing grid lights up.
 *
 * Mounted (flag-gated) by ContentRenderer. The feature flag is checked there; if
 * personId is missing we render a notice.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './PhotoEditor.module.css';
import SlotGrid from './SlotGrid';
import SlotActions from './SlotActions';
import SequenceSidebar from './SequenceSidebar';
import Modal from '../Modal';
import { usePhotoEditorState } from './usePhotoEditorState';
import {
  VIEW_CODES,
  VIEW_OUTPUT,
  parseOriginalViewTag,
  labelForView,
  type PhotoViewCode,
  type SlotHydration,
  type SlotRenderSpec,
} from './photoEditorTypes';
import { useToast } from '../../../contexts/ToastContext';
import sseAppointments from '../../../services/sse-appointments';
import { watchRenderJob } from '../../../services/photo-render-watch';
import { postJSON, deleteJSON, httpErrorMessage } from '../../../core/http';
import { qk } from '@/query/keys';
import { galleryQuery, patientFilesQuery } from '@/query/queries';
import type { FileListing } from '@/types/api.types';

interface Props {
  personId?: number | null;
  tpCode: string;
  tpName: string;
  tpDate: string; // YYYY-MM-DD
}

/** {tpName}_{DD-MM-YYYY} — the originals folder convention on the share. */
function folderName(tpName: string, tpDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tpDate);
  if (!m) return tpName;
  return `${tpName}_${m[3]}-${m[2]}-${m[1]}`;
}

// View-only zoom bounds for the "fit the slots on screen" control. It shrinks the
// slot grid's width via real layout (not transform), so the slots reflow to fit and
// the grid stops overflowing. The sidebar is NOT affected — its width is set by the
// draggable divider. Zoom never touches crop/render state, so Save output is identical
// at any zoom. Max is 100% (full width); below that you shrink to fit.
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1;

// Draggable right-panel (Sequence Files) width, persisted across reloads. Clamped so a
// stray stored value can't produce an unusable panel. With zoom decoupled from the
// sidebar, this width is what now controls thumbnail density (wider ⇒ more columns).
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 250;
const SIDEBAR_KEY = 'pe:sidebarW';

// Editing quality: 'proxy' crops against the 2048px cached server thumbnail
// (fast, light — the DEFAULT), 'original' loads the full-resolution source.
// Saved output always renders server-side from the original at native res; the
// crop rect's pixel space travels with each slot as `cropSpace`, so the two
// modes save identical photos.
const QUALITY_KEY = 'pe:editQuality';

function readStoredQuality(): 'proxy' | 'original' {
  try {
    return localStorage.getItem(QUALITY_KEY) === 'original' ? 'original' : 'proxy';
  } catch {
    return 'proxy';
  }
}

const clampWidth = (n: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));

function readStoredWidth(): number | null {
  try {
    const n = parseInt(localStorage.getItem(SIDEBAR_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const PhotoEditor = ({ personId, tpCode, tpName, tpDate }: Props) => {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editor = usePhotoEditorState();
  const [activeView, setActiveView] = useState<PhotoViewCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const adjustZoom = (delta: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    clampWidth(readStoredWidth() ?? SIDEBAR_DEFAULT),
  );
  const [quality, setQuality] = useState<'proxy' | 'original'>(readStoredQuality);
  const toggleQuality = (): void => {
    setQuality((q) => {
      const next = q === 'proxy' ? 'original' : 'proxy';
      try {
        localStorage.setItem(QUALITY_KEY, next);
      } catch {
        /* ignore persistence failure */
      }
      return next;
    });
  };
  // Per-view "Remove" confirm (right-click menu) + a bump to refresh the sidebar
  // after an original is untagged server-side.
  const [removeTarget, setRemoveTarget] = useState<PhotoViewCode | null>(null);
  const [removing, setRemoving] = useState(false);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // On-open hydration probes (best-effort): the working/ gallery (baked crops) and
  // the timepoint folder listing (tagged originals). Both on React Query so a
  // background render landing just invalidates them → the hydration effect re-runs.
  // `retry: false` so a 404 (folder not created yet) settles to empty immediately.
  const hydrationFolder = folderName(tpName, tpDate);
  const hydrateGalleryQ = useQuery({
    ...galleryQuery(personId ?? '', tpCode),
    enabled: !!personId,
    retry: false,
  });
  const hydrateFilesQ = useQuery({
    ...patientFilesQuery(personId ?? '', hydrationFolder),
    enabled: !!personId,
    retry: false,
  });
  // Set on a successful save, right before the programmatic navigate — the
  // unsaved-changes blocker below must let that navigation through.
  const justSavedRef = useRef(false);

  // Unsaved-changes guard: any slot holding a live edit is hours of framing the
  // router would silently discard. Block in-app navigation with a confirm modal
  // (below) and arm the browser's native prompt for reload/close. Hydrated
  // saved slots have no sourceRelPath, so a freshly opened timepoint is clean.
  const placedCount = VIEW_CODES.filter((v) => editor.slots[v].sourceRelPath).length;
  const blocker = useBlocker(() => placedCount > 0 && !justSavedRef.current);

  // A save (or clearing the last slot) while a navigation sits blocked must not
  // leave a stale confirm modal up.
  useEffect(() => {
    if (blocker.state === 'blocked' && (placedCount === 0 || justSavedRef.current)) {
      blocker.reset();
    }
  }, [blocker, placedCount]);

  useEffect(() => {
    if (placedCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (justSavedRef.current) return;
      e.preventDefault();
      // Chrome requires returnValue to be set for the prompt to appear.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [placedCount]);

  // On open (and whenever either probe settles), hydrate slots that already have a
  // saved crop: show the baked image read-only and, when the source original is
  // still tagged in the folder, enable "Restore original to re-edit". Best-effort;
  // a failed probe just contributes nothing.
  const hydrateGalleryData = hydrateGalleryQ.data;
  const hydrateFilesData = hydrateFilesQ.data;
  useEffect(() => {
    if (!personId) return;
    const gallery = Object.values(hydrateGalleryData ?? {}) as Array<{ name?: string; mtime?: number } | null>;
    const entries = ((hydrateFilesData as FileListing | undefined)?.entries ?? []) as Array<{
      name: string;
      relPath: string;
      type: string;
    }>;
    const views: Partial<Record<PhotoViewCode, SlotHydration>> = {};
    // Cropped images present in working/ → read-only display.
    for (const img of gallery) {
      const name = img?.name;
      const m = name ? /\.(i10|i12|i13|i20|i21|i22|i23|i24)$/.exec(name) : null;
      if (!name || !m) continue;
      views[m[1] as PhotoViewCode] = {
        // Cache-bust with mtime — same reason as the photos grid: an edited
        // slot is re-rendered to the SAME /DolImgs filename, so without a
        // changing URL the re-import page shows the stale pre-edit thumbnail.
        savedImageUrl: img.mtime ? `/DolImgs/${name}?v=${img.mtime}` : `/DolImgs/${name}`,
        canReEdit: false,
        reEditRelPath: null,
        reEditName: null,
      };
    }
    // Tagged originals → enable "Restore original" for their view.
    for (const e of entries) {
      if (e.type !== 'file') continue;
      const tag = parseOriginalViewTag(e.name);
      if (!tag) continue;
      views[tag.view] = {
        ...(views[tag.view] ?? {
          savedImageUrl: null,
          canReEdit: false,
          reEditRelPath: null,
          reEditName: null,
        }),
        canReEdit: true,
        reEditRelPath: e.relPath,
        reEditName: tag.original,
      };
    }
    if (Object.keys(views).length) editor.hydrate(views);
    // editor.hydrate dispatches through a stable reducer dispatch; re-run only when
    // a probe's data changes (covers a background render landing → query invalidated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, tpCode, hydrateGalleryData, hydrateFilesData]);

  // Listen for this timepoint's background-render completion while the editor
  // is open: re-hydrate (sidebar included — its originals get view-tagged by the
  // render). HYDRATE skips any slot with a live edit, so late events can't wipe
  // in-progress framing. Refcounted singleton — same pattern as GridComponent.
  useEffect(() => {
    if (!personId) return;
    const onPhotosRendered = (payload: unknown): void => {
      const p = payload as { personId?: number | string; tpCode?: number | string; tp_code?: number | string };
      const pTp = p.tpCode ?? p.tp_code;
      if (String(p.personId) !== String(personId) || String(pTp) !== String(tpCode)) return;
      // Re-probe gallery + folder (their data change re-runs the hydration effect).
      void queryClient.invalidateQueries({ queryKey: qk.patient.gallery(personId, tpCode) });
      void queryClient.invalidateQueries({ queryKey: qk.patient.filesAll(personId) });
      setSidebarRefresh((n) => n + 1);
    };
    void sseAppointments.ensureConnected().catch(() => {
      /* fall back to the initial one-shot hydration */
    });
    sseAppointments.on('photos_rendered', onPhotosRendered);
    return () => {
      sseAppointments.off('photos_rendered', onPhotosRendered);
      sseAppointments.release();
    };
  }, [personId, tpCode, queryClient]);

  // Drag the divider to resize the right panel. The sidebar sits on the right, so
  // moving the pointer left widens it. Window-level listeners keep the drag alive if
  // the pointer outruns the thin handle; a rAF coalesces moves to one update per frame
  // so the live croppers re-layout at most once per paint.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let latest = startW;
    let raf = 0;
    const apply = (): void => {
      raf = 0;
      setSidebarWidth(latest);
    };
    const onMove = (ev: PointerEvent): void => {
      latest = clampWidth(startW - (ev.clientX - startX));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = (): void => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(latest);
      try {
        localStorage.setItem(SIDEBAR_KEY, String(latest));
      } catch {
        /* ignore persistence failure */
      }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Double-click the divider → restore the default width.
  const resetSidebarWidth = (): void => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
    } catch {
      /* ignore */
    }
  };

  if (!personId) {
    return <div className={styles.notice}>No patient selected.</div>;
  }

  // Originals already dropped into a slot are hidden from the sidebar — a source is
  // "used up" once placed (but never deleted from the folder). Clearing or replacing
  // a slot drops its path from this set, so the photo reappears in the list.
  const usedRelPaths = new Set(
    VIEW_CODES.map((v) => editor.slots[v].sourceRelPath).filter((p): p is string => !!p),
  );

  const handleSave = async (): Promise<void> => {
    const slots: SlotRenderSpec[] = [];
    for (const view of VIEW_CODES) {
      const s = editor.slots[view];
      if (!s.sourceRelPath) continue;
      const a = s.croppedAreaPixels;
      slots.push({
        view,
        sourceRelPath: s.sourceRelPath,
        flipH: s.flipH,
        flipV: s.flipV,
        rotation: s.rotation,
        output: VIEW_OUTPUT[view],
        // Omitted when the slot was never opened — the server centre-crops to the
        // view aspect in that case.
        ...(a ? { extract: { left: a.x, top: a.y, width: a.width, height: a.height } } : {}),
        // The pixel space the extract rect lives in (proxy thumbnail vs full
        // original) — the server scales the rect to source space when they differ.
        ...(s.mediaSize ? { cropSpace: s.mediaSize } : {}),
      });
    }
    if (slots.length === 0) {
      toast.warning('Drop at least one photo into a slot first.');
      return;
    }

    setSaving(true);
    try {
      // The server resolves the timepoint, answers 202, and renders the slots in the
      // background — so this resolves in well under a second regardless of slot count.
      // We navigate straight to the photos grid, which fills in over SSE as the render
      // completes (see GridComponent's photos_rendered handler).
      await postJSON(`/api/photo-editor/${personId}/render`, { tpName, tpDate, slots });
      queryClient.invalidateQueries({ queryKey: qk.patient.timepoints(personId) }); // the render may have created a new timepoint
      // The watchdog toasts the outcome (success/partial/timeout) wherever the
      // user is by then — the grid itself only refetches.
      watchRenderJob({ personId, tpCode, slots: slots.length });
      toast.info(`Saving ${slots.length} photo(s) in the background…`);
      justSavedRef.current = true; // saved — let the navigation below through the blocker
      navigate(`/patient/${personId}/photos/tp${tpCode}`);
    } catch (err) {
      toast.error(`Save failed: ${httpErrorMessage(err, 'unknown error')}`);
    } finally {
      setSaving(false);
    }
  };

  // Right-click "Remove" on a saved slot → delete the cropped view (file + DB row)
  // and untag its original (which the server renames back, returning it to the panel).
  // The original photo is kept. `removeTarget` drives the confirm Modal below.
  const confirmRemoveView = async (): Promise<void> => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await deleteJSON(`/api/photo-editor/${personId}/view`, {
        body: JSON.stringify({ tpCode, tpName, tpDate, view: removeTarget }),
      });
      editor.clear(removeTarget); // empty the slot in the editor
      setSidebarRefresh((n) => n + 1); // re-list the folder (original is back, untagged)
      toast.success('Photo removed.');
      setRemoveTarget(null);
    } catch (err) {
      toast.error(`Remove failed: ${httpErrorMessage(err, 'unknown error')}`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={styles.editor}>
      <header className={styles.topbar}>
        <div className={styles.leftCluster}>
          <div className={styles.titleBlock}>
            <span className={styles.tpName}>{tpName || 'Photo session'}</span>
            {tpDate && <span className={styles.tpDate}>{tpDate}</span>}
            <span className={styles.count}>{placedCount}/8 placed</span>
          </div>
          <SlotActions editor={editor} activeView={activeView} />
        </div>
        <div className={styles.rightTools}>
          <button
            type="button"
            className={styles.qualityToggle}
            onClick={toggleQuality}
            aria-pressed={quality === 'original'}
            title={
              quality === 'proxy'
                ? 'Editing with fast 2048px previews — click to load full-resolution originals (saved photos are always full resolution)'
                : 'Editing with full-resolution originals — click for fast previews (saved photos are always full resolution)'
            }
          >
            <i className={`fas ${quality === 'proxy' ? 'fa-bolt' : 'fa-image'}`} aria-hidden="true" />
            {quality === 'proxy' ? 'Fast preview' : 'Original'}
          </button>
          <div className={styles.zoomControls} role="group" aria-label="Zoom view">
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={() => adjustZoom(-0.1)}
              disabled={zoom <= ZOOM_MIN}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <i className="fas fa-minus" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.zoomLabel}
              onClick={() => setZoom(1)}
              title="Reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={() => adjustZoom(0.1)}
              disabled={zoom >= ZOOM_MAX}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <i className="fas fa-plus" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className={styles.saveBtn}
            disabled={saving || placedCount === 0}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      <div
        className={styles.body}
        style={{ ['--pe-zoom']: zoom, ['--pe-sidebar-w']: `${sidebarWidth}px` } as CSSProperties}
      >
        {/* Clicking any empty space — the gaps, the margins left by zoom-out, or
            below the grid — clears the active slot. Clicks that land on a cell
            (which carries data-slot-cell) keep their own selection; the cell's
            onClick has already run by the time this bubbles up. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss (clears active slot on empty-space click) */}
        <main
          className={styles.gridArea}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-slot-cell]')) setActiveView(null);
          }}
        >
          <SlotGrid
            personId={personId}
            editor={editor}
            activeView={activeView}
            proxyMode={quality === 'proxy'}
            onActivate={setActiveView}
            onRemoveView={setRemoveTarget}
          />
        </main>
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sequence panel"
          onPointerDown={startResize}
          onDoubleClick={resetSidebarWidth}
          title="Drag to resize · double-click to reset"
        />
        <SequenceSidebar
          personId={personId}
          defaultFolder={folderName(tpName, tpDate)}
          usedRelPaths={usedRelPaths}
          refreshSignal={sidebarRefresh}
        />
      </div>
      <Modal isOpen={removeTarget !== null} onClose={() => { if (!removing) setRemoveTarget(null); }}>
        <div className={styles.confirm}>
          <h2 className={styles.confirmTitle}>Remove photo?</h2>
          <p className={styles.confirmText}>
            This removes the cropped{' '}
            <strong>{removeTarget ? labelForView(removeTarget) : ''}</strong> photo from this session. The
            original photo is kept and returns to the Sequence Files panel.
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmCancel}
              onClick={() => setRemoveTarget(null)}
              disabled={removing}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.confirmDanger}
              onClick={confirmRemoveView}
              disabled={removing}
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={blocker.state === 'blocked'} onClose={() => blocker.reset?.()}>
        <div className={styles.confirm}>
          <h2 className={styles.confirmTitle}>Leave photo editor?</h2>
          <p className={styles.confirmText}>
            {placedCount === 1
              ? 'A framed photo hasn’t been saved.'
              : `${placedCount} framed photos haven’t been saved.`}{' '}
            Leaving discards the framing — the original photos stay in their folder.
          </p>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.confirmCancel} onClick={() => blocker.reset?.()}>
              Stay
            </button>
            <button type="button" className={styles.confirmDanger} onClick={() => blocker.proceed?.()}>
              Discard &amp; leave
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PhotoEditor;
