/**
 * PatientSlideshow — operator-controlled presentation builder + player.
 *
 * Lets staff hand-pick photos across a single patient's timepoints, arrange the
 * order, then play an immersive, touch-driven slideshow (for chair-side consults
 * and social-media reels). Frontend-only: reuses the existing timepoints/gallery
 * endpoints. The working sequence is mirrored to sessionStorage so it survives
 * navigating away and back within the session.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../../contexts/ToastContext';
import { generateId } from '../../../core/utils';
import { fetchJSON, postJSON, putJSON, deleteJSON } from '@/core/http';
import { slideshowConfigsQuery, timepointsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import * as patientContract from '@shared/contracts/patient.contract';
import * as slideshowContract from '@shared/contracts/slideshow.contract';
import type { ConfigPayload, ConfigRow } from '@shared/contracts/slideshow.contract';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import SlideshowBuilder from './SlideshowBuilder';
import SlideshowPlayer from './SlideshowPlayer';
import { rebuildLiteral, resolveTemplate } from './configResolver';
import { labelForImageName, isLogoImage, slidePhotoCount, MAX_PHOTOS_PER_SLIDE } from './photoTypes';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import styles from './PatientSlideshow.module.css';
import modalStyles from './SlideshowModals.module.css';

interface Props {
  personId?: number | null;
}

/** Raw shape from GET /api/patients/:id/timepoints (snake_case API). */
interface TimepointApiRow {
  tp_code: string;
  tp_date_time: string;
  tp_description: string;
}

// dd-mm-yyyy, matching the convention used elsewhere (Navigation.formatDate).
function formatDate(dateTime: string): string {
  if (!dateTime) return '';
  return dateTime.substring(0, 10).split('-').reverse().join('-');
}

const sessionKey = (pid: number | null | undefined): string => `slideshow_seq_${pid ?? 'none'}`;

function readSession(pid: number | null | undefined): SlideItem[] {
  try {
    const raw = sessionStorage.getItem(sessionKey(pid));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    // Back-compat: legacy sessions stored a non-unique `id` and no `uid`, and held
    // a single paired photo in `second` (now generalized to the `extras` array).
    // Drop the old id, fold `second` into `extras`, and mint a unique instance id.
    return parsed.map((s: Record<string, unknown>) => {
      const { id: _legacyId, uid, second, extras, ...rest } = s;
      const folded = Array.isArray(extras) ? extras : second ? [second] : undefined;
      return {
        ...rest,
        uid: typeof uid === 'string' ? uid : generateId(),
        ...(folded ? { extras: folded } : {}),
      } as SlideItem;
    });
  } catch {
    return [];
  }
}

function writeSession(pid: number | null | undefined, items: SlideItem[]): void {
  try {
    sessionStorage.setItem(sessionKey(pid), JSON.stringify(items));
  } catch {
    /* storage disabled / quota — non-fatal */
  }
}

// --- Slide/photo helpers (a slide carries one photo, or two when paired) ---
const toPhoto = (item: SlideItem): SlidePhoto => ({
  name: item.name,
  url: item.url,
  tp: item.tp,
  tpDescription: item.tpDescription,
  tpDate: item.tpDate,
  label: item.label,
});

// Wrap a palette photo as a fresh slide instance (unique uid → duplicates allowed).
const newSlide = (photo: SlidePhoto): SlideItem => ({ ...photo, uid: generateId() });

const withoutExtras = (slide: SlideItem): SlideItem => {
  const copy = { ...slide };
  delete copy.extras;
  return copy;
};

const PatientSlideshow = ({ personId }: Props) => {
  const toast = useToast();

  const [galleries, setGalleries] = useState<Record<string, SlidePhoto[]>>({});
  const [selected, setSelected] = useState<SlideItem[]>(() => readSession(personId));
  const [mode, setMode] = useState<'build' | 'play'>('build');
  // A config awaiting confirm because applying it would replace a non-empty timeline.
  const [pendingApply, setPendingApply] = useState<ConfigRow | null>(null);

  // Load timepoints whenever the patient changes.
  const { data: timepointsData, isLoading: loadingTimepoints, isError: timepointsError } = useQuery({
    ...timepointsQuery(personId ?? ''),
    enabled: !!personId,
  });
  const timepoints: Timepoint[] = useMemo(
    () =>
      Array.isArray(timepointsData)
        ? (timepointsData as TimepointApiRow[]).map((r) => ({
            tpCode: r.tp_code,
            tpDateTime: r.tp_date_time,
            tpDescription: r.tp_description,
          }))
        : [],
    [timepointsData]
  );

  useEffect(() => {
    if (timepointsError) toast.error('Failed to load photo sessions');
  }, [timepointsError, toast]);

  // Saved configs: this patient's sequences + the clinic-wide generic templates.
  const { data: configsData } = useQuery({
    ...slideshowConfigsQuery(personId ?? ''),
    enabled: !!personId,
  });
  const configs: ConfigRow[] = configsData ?? [];

  const createMut = useApiMutation({
    mutationFn: (body: slideshowContract.CreateConfigBody) =>
      postJSON<ConfigRow, slideshowContract.CreateConfigBody>('/api/slideshow-configs', body, {
        schema: slideshowContract.createConfig.response,
      }),
    invalidate: () => [qk.slideshow.list(personId ?? '')],
  });
  const renameMut = useApiMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      putJSON<ConfigRow, { name: string }>(`/api/slideshow-configs/${id}`, { name }, {
        schema: slideshowContract.updateConfig.response,
      }),
    invalidate: () => [qk.slideshow.list(personId ?? '')],
  });
  const deleteMut = useApiMutation({
    mutationFn: (id: number) =>
      deleteJSON<{ id: number }>(`/api/slideshow-configs/${id}`, { schema: slideshowContract.deleteConfig.response }),
    invalidate: () => [qk.slideshow.list(personId ?? '')],
  });

  // Hydrate the sequence on patient change; otherwise persist it for this session.
  const pidRef = useRef(personId);
  useEffect(() => {
    if (pidRef.current !== personId) {
      pidRef.current = personId;
      setSelected(readSession(personId));
      setGalleries({});
      setMode('build');
      return;
    }
    writeSession(personId, selected);
  }, [personId, selected]);

  // Lazy-load a timepoint's gallery on first expand; cache the palette photos.
  const loadGallery = async (tp: Timepoint): Promise<SlidePhoto[]> => {
    if (galleries[tp.tpCode]) return galleries[tp.tpCode];
    if (!personId) return [];
    const raw = await fetchJSON<patientContract.GalleryResponse>(`/api/patients/${personId}/gallery/${tp.tpCode}`, { schema: patientContract.gallery.response });
    const items: SlidePhoto[] = Object.values(raw)
      .filter((e): e is NonNullable<typeof e> => !!e && !isLogoImage(e.name))
      .map((e) => ({
        name: e.name,
        // Cache-bust with mtime so a re-rendered slot isn't served stale from cache.
        url: e.mtime ? `/DolImgs/${e.name}?v=${e.mtime}` : `/DolImgs/${e.name}`,
        tp: tp.tpCode,
        tpDescription: tp.tpDescription,
        tpDate: formatDate(tp.tpDateTime),
        label: labelForImageName(e.name),
      }));
    setGalleries((prev) => ({ ...prev, [tp.tpCode]: items }));
    return items;
  };

  // Gallery tap: append a fresh copy to the end (duplicates allowed).
  const addToSequence = (photo: SlidePhoto) => setSelected((prev) => [...prev, newSlide(photo)]);

  // Gallery drag → gap: insert a fresh copy at a specific position.
  const insertAt = (photo: SlidePhoto, index: number) =>
    setSelected((prev) => {
      const at = Math.max(0, Math.min(index, prev.length));
      const next = prev.slice();
      next.splice(at, 0, newSlide(photo));
      return next;
    });

  // Gallery drag → chip: add the photo to the target slide as a side-by-side extra.
  const pairPhotoOnto = (targetIndex: number, photo: SlidePhoto) =>
    setSelected((prev) => {
      const target = prev[targetIndex];
      if (!target) return prev;
      if (slidePhotoCount(target) >= MAX_PHOTOS_PER_SLIDE) {
        toast.info(`A slide can hold at most ${MAX_PHOTOS_PER_SLIDE} photos`);
        return prev;
      }
      const next = prev.slice();
      next[targetIndex] = { ...target, extras: [...(target.extras ?? []), { ...photo }] };
      return next;
    });

  // Tray chip ✕ removes that one instance (both photos of a pair); use unpair to split.
  const removeSelect = (uid: string) => setSelected((prev) => prev.filter((s) => s.uid !== uid));

  // Chip drag → another chip: add the dragged single photo to the target slide.
  const pairSlides = (fromIndex: number, toIndex: number) =>
    setSelected((prev) => {
      if (fromIndex === toIndex) return prev;
      const from = prev[fromIndex];
      const to = prev[toIndex];
      if (!from || !to) return prev;
      if (slidePhotoCount(from) > 1) {
        toast.info('Drag a single photo onto another to combine them');
        return prev;
      }
      if (slidePhotoCount(to) >= MAX_PHOTOS_PER_SLIDE) {
        toast.info(`A slide can hold at most ${MAX_PHOTOS_PER_SLIDE} photos`);
        return prev;
      }
      const next = prev.slice();
      next[toIndex] = { ...to, extras: [...(to.extras ?? []), toPhoto(from)] };
      next.splice(fromIndex, 1); // remove the dragged slide from its old slot
      return next;
    });

  // Split a multi-photo slide back into consecutive single slides.
  const unpair = (index: number) => {
    setSelected((prev) => {
      const slide = prev[index];
      if (!slide?.extras?.length) return prev;
      const singles = [withoutExtras(slide), ...slide.extras.map(newSlide)];
      const next = prev.slice();
      next.splice(index, 1, ...singles);
      return next;
    });
  };

  const clearSelect = () => setSelected([]);

  const moveSlide = (from: number, to: number) => {
    setSelected((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const play = () => {
    if (selected.length === 0) return;
    setMode('play');
  };

  // --- Saved configs: write + apply ---
  const handleSaveConfig = async (name: string, config: ConfigPayload): Promise<void> => {
    if (personId == null) return;
    await createMut.mutateAsync({
      personId: config.kind === 'template' ? null : personId,
      name,
      config,
    });
  };
  const handleRenameConfig = async (id: number, name: string): Promise<void> => {
    await renameMut.mutateAsync({ id, name });
  };
  const handleDeleteConfig = async (id: number): Promise<void> => {
    await deleteMut.mutateAsync(id);
  };

  // Resolve a config to slides and replace the timeline. Literals rebuild
  // verbatim; templates resolve against this patient's timepoints (some photos
  // may be missing → surfaced via toast).
  const doApply = async (row: ConfigRow): Promise<void> => {
    if (personId == null) return;
    if (row.config.kind === 'literal') {
      setSelected(rebuildLiteral(row.config, personId));
      toast.success(`Applied “${row.name}”`);
      return;
    }
    try {
      const { slides, missing } = await resolveTemplate(row.config, timepoints, loadGallery);
      if (slides.length === 0) {
        toast.error(`“${row.name}” has no matching photos for this patient`);
        return;
      }
      setSelected(slides);
      if (missing > 0) {
        toast.info(`Applied “${row.name}” — ${missing} photo${missing === 1 ? '' : 's'} not available for this patient`);
      } else {
        toast.success(`Applied “${row.name}”`);
      }
    } catch {
      toast.error('Failed to build the presentation from this template');
    }
  };

  // Confirm before replacing a non-empty timeline.
  const requestApply = (row: ConfigRow): void => {
    if (selected.length === 0) void doApply(row);
    else setPendingApply(row);
  };
  const confirmApply = (): void => {
    const row = pendingApply;
    setPendingApply(null);
    if (row) void doApply(row);
  };

  if (!personId) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>Select a patient to build a presentation.</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <SlideshowBuilder
        personId={personId}
        timepoints={timepoints}
        loadingTimepoints={loadingTimepoints}
        galleries={galleries}
        loadGallery={loadGallery}
        selected={selected}
        configs={configs}
        onAdd={addToSequence}
        onInsertAt={insertAt}
        onPairPhotoOnto={pairPhotoOnto}
        onReorder={moveSlide}
        onPairSlides={pairSlides}
        onRemove={removeSelect}
        onUnpair={unpair}
        onClear={clearSelect}
        onPlay={play}
        onApplyConfig={requestApply}
        onSaveConfig={handleSaveConfig}
        onRenameConfig={handleRenameConfig}
        onDeleteConfig={handleDeleteConfig}
      />
      {mode === 'play' && selected.length > 0 && (
        <SlideshowPlayer slides={selected} onExit={() => setMode('build')} />
      )}

      {pendingApply && (
        <Modal
          isOpen
          onClose={() => setPendingApply(null)}
          contentClassName={modalStyles.dialog}
          ariaLabelledBy="slideshow-apply-confirm-title"
        >
          <ModalHeader
            title="Replace current timeline?"
            titleId="slideshow-apply-confirm-title"
            variant="warning"
            icon={<i className="fas fa-triangle-exclamation" />}
            onClose={() => setPendingApply(null)}
          />
          <div className={modalStyles.body}>
            <p className={modalStyles.lead}>
              Applying “{pendingApply.name}” will replace the {selected.length} photo
              {selected.length === 1 ? '' : 's'} currently in your timeline.
            </p>
          </div>
          <div className={modalStyles.footer}>
            <button type="button" className="btn btn-secondary" onClick={() => setPendingApply(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmApply}>
              Replace
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PatientSlideshow;
