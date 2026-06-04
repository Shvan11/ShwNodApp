/**
 * Native Dolphin-style photo layout manager (Phase 4). Drag originals from the
 * Sequence Files sidebar into the 8 view slots, frame each, then Save — the
 * server (sharp) renders working/{pid}0{tp}.iNN so the existing grid lights up.
 *
 * Mounted (flag-gated) by ContentRenderer. The feature flag is checked there; if
 * personId is missing we render a notice.
 */
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { fetchJSON, postJSON, deleteJSON, httpErrorMessage } from '../../../core/http';

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
  const editor = usePhotoEditorState();
  const [activeView, setActiveView] = useState<PhotoViewCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const adjustZoom = (delta: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    clampWidth(readStoredWidth() ?? SIDEBAR_DEFAULT),
  );
  // Per-view "Remove" confirm (right-click menu) + a bump to refresh the sidebar
  // after an original is untagged server-side.
  const [removeTarget, setRemoveTarget] = useState<PhotoViewCode | null>(null);
  const [removing, setRemoving] = useState(false);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // On open, hydrate slots that already have a saved crop: show the baked image
  // read-only and, when the source original is still tagged in the folder, enable
  // "Restore original to re-edit". Reuses the gallery probe + the folder listing —
  // no new endpoint. Best-effort; a failure just leaves the grid empty.
  useEffect(() => {
    if (!personId) return;
    let cancelled = false;
    const folder = folderName(tpName, tpDate);
    (async () => {
      try {
        // Independent best-effort probes: a per-promise .catch keeps one failing
        // without blanking the other (the files route is the sendSuccess envelope,
        // so fetchJSON unwraps it to { entries }).
        const [gallery, files] = await Promise.all([
          fetchJSON<Array<{ name?: string } | null>>(
            `/api/patients/${personId}/gallery/${tpCode}`,
          ).catch(() => [] as Array<{ name?: string } | null>),
          fetchJSON<{ entries?: Array<{ name: string; relPath: string; type: string }> }>(
            `/api/patients/${personId}/files?path=${encodeURIComponent(folder)}`,
          ).catch(() => null),
        ]);
        if (cancelled) return;
        const views: Partial<Record<PhotoViewCode, SlotHydration>> = {};
        // Cropped images present in working/ → read-only display.
        if (Array.isArray(gallery)) {
          for (const img of gallery) {
            const name = img?.name;
            const m = name ? /\.(i10|i12|i13|i20|i21|i22|i23|i24)$/.exec(name) : null;
            if (!name || !m) continue;
            views[m[1] as PhotoViewCode] = {
              savedImageUrl: `/DolImgs/${name}`,
              canReEdit: false,
              reEditRelPath: null,
              reEditName: null,
            };
          }
        }
        // Tagged originals → enable "Restore original" for their view.
        const entries = files?.entries ?? [];
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
      } catch {
        /* best-effort hydration */
      }
    })();
    return () => {
      cancelled = true;
    };
    // editor.hydrate dispatches through a stable reducer dispatch; re-run only per timepoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, tpCode, tpName, tpDate]);

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

  const placedCount = VIEW_CODES.filter((v) => editor.slots[v].sourceRelPath).length;

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
      toast.info(`Saving ${slots.length} photo(s) in the background…`);
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
            <span className={styles.tpName}>{tpName || 'Timepoint'}</span>
            {tpDate && <span className={styles.tpDate}>{tpDate}</span>}
            <span className={styles.count}>{placedCount}/8 placed</span>
          </div>
          <SlotActions editor={editor} activeView={activeView} />
        </div>
        <div className={styles.rightTools}>
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
            <strong>{removeTarget ? labelForView(removeTarget) : ''}</strong> photo from this timepoint. The
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
    </div>
  );
};

export default PhotoEditor;
