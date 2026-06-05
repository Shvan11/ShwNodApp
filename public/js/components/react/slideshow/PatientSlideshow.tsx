/**
 * PatientSlideshow — operator-controlled presentation builder + player.
 *
 * Lets staff hand-pick photos across a single patient's timepoints, arrange the
 * order, then play an immersive, touch-driven slideshow (for chair-side consults
 * and social-media reels). Frontend-only: reuses the existing timepoints/gallery
 * endpoints. The working sequence is mirrored to sessionStorage so it survives
 * navigating away and back within the session.
 */
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { generateId } from '../../../core/utils';
import { fetchJSON } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import SlideshowBuilder from './SlideshowBuilder';
import SlideshowPlayer from './SlideshowPlayer';
import { labelForImageName, isLogoImage } from './photoTypes';
import type { SlideItem, SlidePhoto, Timepoint } from './types';
import styles from './PatientSlideshow.module.css';

interface Props {
  personId?: number | null;
}

interface GalleryEntry {
  name: string;
  width?: number;
  height?: number;
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
    // Back-compat: legacy sessions stored a non-unique `id` and no `uid`.
    // Drop the old id and mint a unique instance id so duplicates can't collide.
    return parsed.map((s: Record<string, unknown>) => {
      const { id: _legacyId, uid, ...rest } = s;
      return { ...rest, uid: typeof uid === 'string' ? uid : generateId() } as SlideItem;
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

const withoutSecond = (slide: SlideItem): SlideItem => {
  const copy = { ...slide };
  delete copy.second;
  return copy;
};

const PatientSlideshow = ({ personId }: Props) => {
  const toast = useToast();

  const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
  const [loadingTimepoints, setLoadingTimepoints] = useState(true);
  const [galleries, setGalleries] = useState<Record<string, SlidePhoto[]>>({});
  const [selected, setSelected] = useState<SlideItem[]>(() => readSession(personId));
  const [mode, setMode] = useState<'build' | 'play'>('build');

  // Load timepoints whenever the patient changes.
  useEffect(() => {
    if (!personId) {
      setLoadingTimepoints(false);
      return;
    }
    const ctrl = new AbortController();
    setLoadingTimepoints(true);
    fetchJSON<TimepointApiRow[]>(`/api/patients/${personId}/timepoints`, { signal: ctrl.signal, schema: patientContract.timepoints.response })
      .then((data) =>
        setTimepoints(
          Array.isArray(data)
            ? data.map((r) => ({
                tpCode: r.tp_code,
                tpDateTime: r.tp_date_time,
                tpDescription: r.tp_description,
              }))
            : []
        )
      )
      .catch((err) => {
        if (err.name !== 'AbortError') {
          toast.error('Failed to load photo sessions');
          setTimepoints([]);
        }
      })
      .finally(() => setLoadingTimepoints(false));
    return () => ctrl.abort();
  }, [personId, toast]);

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
    const raw = await fetchJSON<(GalleryEntry | null)[]>(`/api/patients/${personId}/gallery/${tp.tpCode}`, { schema: patientContract.gallery.response });
    const items: SlidePhoto[] = raw
      .filter((e): e is GalleryEntry => !!e && !isLogoImage(e.name))
      .map((e) => ({
        name: e.name,
        url: `/DolImgs/${e.name}`,
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

  // Gallery drag → chip: make the target slide a side-by-side pair (right-hand photo).
  const pairPhotoOnto = (targetIndex: number, photo: SlidePhoto) =>
    setSelected((prev) => {
      const target = prev[targetIndex];
      if (!target) return prev;
      if (target.second) {
        toast.info('That slide already has two photos');
        return prev;
      }
      const next = prev.slice();
      next[targetIndex] = { ...target, second: { ...photo } };
      return next;
    });

  // Tray chip ✕ removes that one instance (both photos of a pair); use unpair to split.
  const removeSelect = (uid: string) => setSelected((prev) => prev.filter((s) => s.uid !== uid));

  // Chip drag → another chip: merge two single slides (target = left, dragged = right).
  const pairSlides = (fromIndex: number, toIndex: number) =>
    setSelected((prev) => {
      if (fromIndex === toIndex) return prev;
      const from = prev[fromIndex];
      const to = prev[toIndex];
      if (!from || !to) return prev;
      if (from.second || to.second) {
        toast.info('Both slides must be single to combine');
        return prev;
      }
      const next = prev.slice();
      next[toIndex] = { ...to, second: toPhoto(from) };
      next.splice(fromIndex, 1); // remove the dragged slide from its old slot
      return next;
    });

  // Split a paired slide back into two consecutive single slides.
  const unpair = (index: number) => {
    setSelected((prev) => {
      const slide = prev[index];
      if (!slide?.second) return prev;
      const next = prev.slice();
      next[index] = withoutSecond(slide);
      next.splice(index + 1, 0, newSlide(slide.second));
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
        timepoints={timepoints}
        loadingTimepoints={loadingTimepoints}
        galleries={galleries}
        loadGallery={loadGallery}
        selected={selected}
        onAdd={addToSequence}
        onInsertAt={insertAt}
        onPairPhotoOnto={pairPhotoOnto}
        onReorder={moveSlide}
        onPairSlides={pairSlides}
        onRemove={removeSelect}
        onUnpair={unpair}
        onClear={clearSelect}
        onPlay={play}
      />
      {mode === 'play' && selected.length > 0 && (
        <SlideshowPlayer slides={selected} onExit={() => setMode('build')} />
      )}
    </div>
  );
};

export default PatientSlideshow;
