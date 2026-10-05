/**
 * Native Dolphin-style photo layout manager (Phase 4). Drag originals from the
 * Sequence Files sidebar into the 8 view slots (or click a photo, then a slot), frame
 * each, then Save — the server (sharp) renders working/{pid}0{tp}.iNN so the grid
 * lights up. Save writes only the slots that differ from what is saved; Cancel leaves
 * without saving (asking first when something would be lost).
 *
 * Each render records its framing (zoom, rotation, flips, frame) inside the saved
 * photo, so a saved view can be reopened where it was left ("Continue editing") as
 * well as from scratch. The Overlay tool lays another session's saved views faintly
 * over the slots, to frame a new session the way the last one was framed.
 *
 * Mounted by ContentRenderer at `/photo-editor/tp{code}`, keyed by the code. The
 * session's name and date come from the timepoints read BY CODE, never from the URL:
 * a stale URL (Back after a re-date, a second tab) used to make the save find-or-create
 * a session by that name and date — a duplicate — and render into it (FE-F14-3).
 */
import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './PhotoEditor.module.css';
import SlotGrid from './SlotGrid';
import SlotActions from './SlotActions';
import SequenceSidebar, { type ArmedPhoto } from './SequenceSidebar';
import { usePhotoEditorState } from './usePhotoEditorState';
import {
  EMPTY_HYDRATION,
  VIEW_CODES,
  VIEW_OUTPUT,
  parseOriginalViewTag,
  labelForView,
  type PhotoViewCode,
  type SlotHydration,
  type SlotRenderSpec,
} from './photoEditorTypes';
import { framingMatchesOriginal, isSlotDirty } from './framing';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useUnsavedRouteGuard } from '../../../hooks/useUnsavedRouteGuard';
import sseAppointments from '../../../services/sse-appointments';
import { newRenderJobId, watchRenderJob } from '../../../services/photo-render-watch';
import { postJSON, deleteJSON, httpErrorMessage } from '../../../core/http';
import { qk } from '@/query/keys';
import { invalidatePatientPhotos } from '@/query/photos';
import { framingQuery, galleryQuery, patientFilesQuery, timepointsQuery } from '@/query/queries';
import { sessionFolderName } from '@shared/photo-session-folder';
import { renderedEvent } from '@shared/contracts/photo-editor.contract';
import type { GalleryResponse, TimepointRow } from '@shared/contracts/patient.contract';
import { buildWorkingContentUrl } from '../files/fileHelpers';

interface Props {
  personId?: number | null;
  tpCode: string;
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

// The Overlay tool: another session's saved photos laid faintly over the slots, to
// frame this session the way that one was framed. On/off and strength persist per
// device; which session is per patient, so it is chosen afresh (default: the latest
// session before this one).
const OVERLAY_KEY = 'pe:overlay';
const OVERLAY_OPACITY_KEY = 'pe:overlayOpacity';
const OVERLAY_OPACITY_DEFAULT = 0.35;
const OVERLAY_OPACITY_MIN = 0.1;
const OVERLAY_OPACITY_MAX = 0.8;

function readStoredOverlay(): boolean {
  try {
    return localStorage.getItem(OVERLAY_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredOverlayOpacity(): number {
  try {
    const n = Number(localStorage.getItem(OVERLAY_OPACITY_KEY));
    return n >= OVERLAY_OPACITY_MIN && n <= OVERLAY_OPACITY_MAX ? n : OVERLAY_OPACITY_DEFAULT;
  } catch {
    return OVERLAY_OPACITY_DEFAULT;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore persistence failure */
  }
}

/** Chronological order: date, then code (two sessions can share a day). */
function sessionOrder(a: TimepointRow, b: TimepointRow): number {
  if (a.tp_date_time !== b.tp_date_time) return a.tp_date_time < b.tp_date_time ? -1 : 1;
  return Number(a.tp_code) - Number(b.tp_code);
}

function readStoredWidth(): number | null {
  try {
    const n = parseInt(localStorage.getItem(SIDEBAR_KEY) ?? '', 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const PhotoEditor = ({ personId, tpCode }: Props) => {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editor = usePhotoEditorState();

  // The session this editor shows — by code (see the docblock).
  const sessionsQ = useQuery({ ...timepointsQuery(personId ?? ''), enabled: !!personId });
  const session = sessionsQ.data?.find((t) => t.tp_code === tpCode) ?? null;
  const tpName = session?.tp_description ?? '';
  const tpDate = session?.tp_date_time ?? '';
  const sessionFolder = sessionFolderName(tpName, tpDate) ?? '';
  // A sidebar photo picked by click or keyboard, waiting for a slot — the
  // non-drag way to place a photo (FE-F14-13a). Escape puts it back.
  const [armed, setArmed] = useState<ArmedPhoto | null>(null);
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setArmed(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [armed]);
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
  // A bump to refresh the sidebar after an original is untagged server-side.
  const [removing, setRemoving] = useState(false);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // The Overlay tool (see OVERLAY_KEY). The sessions it can show: every other one, in
  // date order; unless the user picks one, the latest before this session (else the
  // earliest after it — re-framing an Initial against a later session).
  const [overlayOn, setOverlayOn] = useState<boolean>(readStoredOverlay);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(readStoredOverlayOpacity);
  const [overlayPick, setOverlayPick] = useState<string | null>(null);
  const otherSessions = (sessionsQ.data ?? []).filter((t) => t.tp_code !== tpCode).sort(sessionOrder);
  const overlayDefault = session
    ? (otherSessions.filter((t) => sessionOrder(t, session) < 0).at(-1) ?? otherSessions[0] ?? null)
    : null;
  const overlayTp =
    overlayPick && otherSessions.some((t) => t.tp_code === overlayPick) ? overlayPick : (overlayDefault?.tp_code ?? null);
  const overlayGalleryQ = useQuery({
    ...galleryQuery(personId ?? '', overlayTp ?? ''),
    enabled: !!personId && overlayOn && !!overlayTp,
    retry: false,
  });
  const overlayUrls: Partial<Record<PhotoViewCode, string>> = {};
  if (personId && overlayOn && overlayGalleryQ.data) {
    for (const view of VIEW_CODES) {
      const img = overlayGalleryQ.data[view];
      // The grid's 480 px thumbnail: a faint guide needs no more, and it is usually cached.
      if (img) overlayUrls[view] = buildWorkingContentUrl(personId, img.name, { thumb: 480, v: img.mtime });
    }
  }

  // On-open hydration probes (best-effort): the working/ gallery (baked crops) and
  // the timepoint folder listing (tagged originals). Both on React Query so a
  // background render landing just invalidates them → the hydration effect re-runs.
  // `retry: false` so a 404 (folder not created yet) settles to empty immediately.
  const hydrateGalleryQ = useQuery({
    ...galleryQuery(personId ?? '', tpCode),
    enabled: !!personId && !!session,
    retry: false,
  });
  const hydrateFilesQ = useQuery({
    ...patientFilesQuery(personId ?? '', sessionFolder),
    enabled: !!personId && !!sessionFolder,
    retry: false,
  });
  // The framing each saved view was rendered with — "Continue editing" + the readout.
  const hydrateFramingQ = useQuery({
    ...framingQuery(personId ?? '', tpCode),
    enabled: !!personId && !!session,
    retry: false,
  });

  // Unsaved-changes guard: a slot whose live edit differs from what is saved is
  // framing the router would silently discard. The shared page guard (useConfirm + the
  // `common:unsaved.*` wording + beforeunload) — this file used to hand-roll all of
  // it (FE-F14-8). Hydrated saved slots have no live edit, and a saved view reopened
  // with its saved framing is not a change until it is moved, so neither asks.
  const dirtyViews = VIEW_CODES.filter((v) => isSlotDirty(editor.slots[v]));
  const filledCount = VIEW_CODES.filter((v) => editor.slots[v].sourceRelPath || editor.slots[v].savedImageUrl).length;
  const { allowNextNavigation } = useUnsavedRouteGuard(dirtyViews.length > 0);

  // On open (and whenever either probe settles), sync the slots with what is saved:
  // the baked image read-only and, when the source original is still tagged in the
  // folder, "Restore original to re-edit". AUTHORITATIVE — a view the gallery no
  // longer has is cleared (unless it holds a live edit); a removed photo used to come
  // back from the stale cache at once (FE-F14-2). Best-effort: a failed probe
  // contributes nothing.
  const hydrateGalleryData: GalleryResponse | undefined = hydrateGalleryQ.data;
  const hydrateFilesData = hydrateFilesQ.data;
  const hydrateFramingData = hydrateFramingQ.data;
  useEffect(() => {
    if (!personId || !hydrateGalleryData) return;
    const views: Partial<Record<PhotoViewCode, SlotHydration>> = {};
    // Cropped images present in working/ → read-only display, as the grid's 480 px
    // thumbnail: the full render (median 2.2 MB, ~18 MP) was downloaded to fill a cell
    // a few hundred pixels wide, eight times per open (FE-F14-12). `v=mtime` busts the
    // cache when a slot is re-rendered under the same name.
    for (const view of VIEW_CODES) {
      const img = hydrateGalleryData[view];
      if (!img) continue;
      views[view] = {
        ...EMPTY_HYDRATION,
        savedImageUrl: buildWorkingContentUrl(personId, img.name, { thumb: 480, v: img.mtime }),
        savedSize: { width: img.width, height: img.height },
        savedFraming: hydrateFramingData?.[view] ?? null,
      };
    }
    // Tagged originals → enable re-editing for their view.
    for (const e of hydrateFilesData?.entries ?? []) {
      if (e.type !== 'file') continue;
      const tag = parseOriginalViewTag(e.name);
      if (!tag) continue;
      views[tag.view] = {
        ...(views[tag.view] ?? EMPTY_HYDRATION),
        canReEdit: true,
        reEditRelPath: e.relPath,
        reEditName: tag.original,
        reEditVersion: e.modified ?? null,
      };
    }
    // "Continue editing" needs the recorded framing to belong to the original that is
    // tagged NOW — a re-tagged or replaced one would get the old frame.
    for (const view of VIEW_CODES) {
      const h = views[view];
      if (h?.savedFraming && h.canReEdit) {
        h.canContinue = framingMatchesOriginal(h.savedFraming, h.reEditName, h.reEditVersion);
      }
    }
    editor.hydrate(views);
    // editor.hydrate dispatches through a stable reducer dispatch; re-run only when
    // a probe's data changes (covers a background render landing → query invalidated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, tpCode, hydrateGalleryData, hydrateFilesData, hydrateFramingData]);

  // Listen for this timepoint's background-render completion while the editor
  // is open: re-hydrate (sidebar included — its originals get view-tagged by the
  // render). HYDRATE skips any slot with a live edit, so late events can't wipe
  // in-progress framing. Refcounted singleton — same pattern as GridComponent.
  useEffect(() => {
    if (!personId) return;
    const onPhotosRendered = (payload: unknown): void => {
      const p = renderedEvent.safeParse(payload);
      if (!p.success || String(p.data.personId) !== String(personId) || String(p.data.tpCode) !== String(tpCode)) return;
      // Re-probe gallery + folder (their data change re-runs the hydration effect).
      void invalidatePatientPhotos(personId);
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
  const persistWidth = (w: number): void => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(w));
    } catch {
      /* ignore persistence failure */
    }
  };

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
    // pointercancel too: a cancelled touch or pen drag used to leave the body stuck
    // at `col-resize` / `user-select: none` (FE-F14-13).
    const onUp = (): void => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(latest);
      persistWidth(latest);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // The divider is a focusable separator: ←/→ resize it from the keyboard (FE-F14-13c).
  const onResizerKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 60 : 20;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = clampWidth(sidebarWidth + step);
    else if (e.key === 'ArrowRight') next = clampWidth(sidebarWidth - step);
    else if (e.key === 'Home') next = SIDEBAR_MAX;
    else if (e.key === 'End') next = SIDEBAR_MIN;
    if (next === null) return;
    e.preventDefault();
    setSidebarWidth(next);
    persistWidth(next);
  };

  // Double-click the divider → restore the default width.
  const resetSidebarWidth = (): void => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    persistWidth(SIDEBAR_DEFAULT);
  };

  if (!personId) {
    return <div className={styles.notice}>No patient selected.</div>;
  }
  if (sessionsQ.isLoading) {
    return <div className={styles.notice}>Loading photo session…</div>;
  }
  if (!session) {
    return (
      <div className={styles.notice}>
        <p>This photo session no longer exists — it may have been deleted or renamed elsewhere.</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(`/patient/${personId}/photos`)}>
          Back to photos
        </button>
      </div>
    );
  }

  // Originals already dropped into a slot are hidden from the sidebar — a source is
  // "used up" once placed (but never deleted from the folder). Clearing or replacing
  // a slot drops its path from this set, so the photo reappears in the list.
  const usedRelPaths = new Set(
    VIEW_CODES.map((v) => editor.slots[v].sourceRelPath).filter((p): p is string => !!p),
  );

  const handleSave = async (): Promise<void> => {
    const slots: SlotRenderSpec[] = [];
    // Only what differs from disk: re-rendering an untouched slot would rewrite the
    // same photo for nothing.
    for (const view of dirtyViews) {
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
        // The framing record the render embeds, so this view can be continued later.
        ...(a && s.croppedArea ? { framing: { area: s.croppedArea, zoom: s.zoom } } : {}),
      });
    }
    if (slots.length === 0) {
      toast.warning('Nothing to save — no photo has changed.');
      return;
    }

    setSaving(true);
    // The watcher is registered BEFORE the request leaves, keyed by a job id the
    // server echoes in its completion event: a render that fails at once announces
    // before the 202 is even parsed, and used to be reported 105 s later as "taking
    // longer than expected" (FE-F14-4). It toasts the outcome — naming each photo that
    // failed and why — wherever the user is by then.
    const jobId = newRenderJobId();
    const watch = watchRenderJob({ jobId, personId, tpCode, slots: slots.length });
    try {
      await watch.ready;
      // The server renders into the session BY CODE and answers 202; the slots render
      // in the background, so this resolves in well under a second.
      await postJSON(`/api/photo-editor/${personId}/render`, { tpCode: Number(tpCode), jobId, slots });
      toast.info(`Saving ${slots.length} photo(s) in the background…`);
      allowNextNavigation(); // saved — let the navigation below through the guard
      navigate(`/patient/${personId}/photos/tp${tpCode}`);
    } catch (err) {
      watch.cancel();
      toast.error(`Save failed: ${httpErrorMessage(err, 'unknown error')}`);
    } finally {
      setSaving(false);
    }
  };

  // "Remove" on a saved slot → delete the cropped view (file + DB row) and untag its
  // original (which the server renames back, returning it to the panel). The original
  // photo is kept. The shared confirm (FE-F14-8), not a bespoke modal.
  const removeView = async (view: PhotoViewCode): Promise<void> => {
    if (removing) return;
    const ok = await confirm(
      `This removes the cropped ${labelForView(view)} photo from this session. The original photo is kept and returns to the Sequence Files panel.`,
      { title: 'Remove photo?', confirmText: 'Remove', danger: true }
    );
    if (!ok) return;
    setRemoving(true);
    try {
      await deleteJSON(`/api/photo-editor/${personId}/view`, {
        body: JSON.stringify({ tpCode, view }),
      });
      // The cached gallery still lists the file; mark it gone NOW, before the refetch,
      // or the hydration below re-seeds the slot from it (FE-F14-2).
      queryClient.setQueryData<GalleryResponse>(qk.patient.gallery(personId, tpCode), (old) =>
        old ? { ...old, [view]: null } : old
      );
      editor.clear(view); // empty the slot in the editor
      void invalidatePatientPhotos(personId); // grid, Compare, slideshow, working files
      setSidebarRefresh((n) => n + 1); // re-list the folder (original is back, untagged)
      toast.success('Photo removed.');
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
            <span className={styles.count}>
              {filledCount}/8
              {dirtyViews.length > 0 && <span className={styles.unsavedCount}> · {dirtyViews.length} unsaved</span>}
            </span>
          </div>
          <SlotActions
            personId={personId}
            editor={editor}
            activeView={activeView}
            proxyMode={quality === 'proxy'}
            onRemoveSaved={(view) => void removeView(view)}
          />
        </div>
        <div className={styles.rightTools}>
          <div className={styles.overlayControls} role="group" aria-label="Overlay another session">
            <button
              type="button"
              className={styles.overlayToggle}
              onClick={() => {
                const next = !overlayOn;
                setOverlayOn(next);
                persist(OVERLAY_KEY, next ? '1' : '0');
              }}
              aria-pressed={overlayOn}
              disabled={!overlayTp}
              title={
                overlayTp
                  ? "Lay another session's saved photos faintly over the slots, to frame this session the same way"
                  : 'No other photo session to overlay'
              }
            >
              <i className="fas fa-layer-group" aria-hidden="true" />
              Overlay
            </button>
            {overlayOn && overlayTp && (
              <>
                <select
                  className={styles.overlaySelect}
                  value={overlayTp}
                  onChange={(e) => setOverlayPick(e.target.value)}
                  aria-label="Session to overlay"
                  title="Session to overlay"
                >
                  {otherSessions.map((t) => (
                    <option key={t.tp_code} value={t.tp_code}>
                      {t.tp_description} · {t.tp_date_time}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  className={styles.overlayRange}
                  min={OVERLAY_OPACITY_MIN * 100}
                  max={OVERLAY_OPACITY_MAX * 100}
                  step={5}
                  value={Math.round(overlayOpacity * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setOverlayOpacity(v);
                    persist(OVERLAY_OPACITY_KEY, String(v));
                  }}
                  aria-label="Overlay strength"
                  title={`Overlay strength ${Math.round(overlayOpacity * 100)}%`}
                />
              </>
            )}
          </div>
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
            className={styles.cancelBtn}
            disabled={saving}
            // Back to the session's photos. The route guard asks first when an
            // unsaved change would be lost; with none, this just leaves.
            onClick={() => navigate(`/patient/${personId}/photos/tp${tpCode}`)}
            title={dirtyViews.length > 0 ? 'Leave without saving the changed photos' : 'Back to the photos'}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.saveBtn}
            disabled={saving || dirtyViews.length === 0}
            onClick={handleSave}
            title={dirtyViews.length === 0 ? 'Nothing to save — no photo has changed' : undefined}
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
            armed={armed}
            onPlaced={() => setArmed(null)}
            onActivate={setActiveView}
            onRemoveView={(view) => void removeView(view)}
            overlayUrls={overlayUrls}
            overlayOpacity={overlayOpacity}
          />
        </main>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator with a value is the WAI-ARIA window-splitter pattern; ←/→ resize it */}
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sequence panel"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={sidebarWidth}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the window-splitter pattern: a separator with a value is focusable
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={onResizerKey}
          onDoubleClick={resetSidebarWidth}
          title="Drag (or use ←/→) to resize · double-click to reset"
        />
        <SequenceSidebar
          personId={personId}
          sessions={sessionsQ.data ?? []}
          defaultFolder={sessionFolder}
          sessionDate={tpDate}
          usedRelPaths={usedRelPaths}
          refreshSignal={sidebarRefresh}
          armed={armed}
          onArm={setArmed}
        />
      </div>
    </div>
  );
};

export default PhotoEditor;
