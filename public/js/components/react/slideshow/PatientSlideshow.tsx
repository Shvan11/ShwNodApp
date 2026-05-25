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
import SlideshowBuilder from './SlideshowBuilder';
import SlideshowPlayer from './SlideshowPlayer';
import { labelForImageName, isLogoImage } from './photoTypes';
import type { SlideItem, Timepoint } from './types';
import styles from './PatientSlideshow.module.css';

interface Props {
  personId?: number | null;
}

interface GalleryEntry {
  name: string;
  width?: number;
  height?: number;
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
    return Array.isArray(parsed) ? (parsed as SlideItem[]) : [];
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

const PatientSlideshow = ({ personId }: Props) => {
  const toast = useToast();

  const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
  const [loadingTimepoints, setLoadingTimepoints] = useState(true);
  const [galleries, setGalleries] = useState<Record<string, SlideItem[]>>({});
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
    fetch(`/api/patients/${personId}/timepoints`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Timepoint[]) => setTimepoints(Array.isArray(data) ? data : []))
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

  // Lazy-load a timepoint's gallery on first expand; cache filtered SlideItems.
  const loadGallery = async (tp: Timepoint): Promise<SlideItem[]> => {
    if (galleries[tp.tpCode]) return galleries[tp.tpCode];
    if (!personId) return [];
    const res = await fetch(`/api/patients/${personId}/gallery/${tp.tpCode}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as (GalleryEntry | null)[];
    const items: SlideItem[] = raw
      .filter((e): e is GalleryEntry => !!e && !isLogoImage(e.name))
      .map((e) => ({
        id: `${tp.tpCode}:${e.name}`,
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

  const toggleSelect = (item: SlideItem) => {
    setSelected((prev) =>
      prev.some((s) => s.id === item.id)
        ? prev.filter((s) => s.id !== item.id)
        : [...prev, item],
    );
  };

  const removeSelect = (id: string) => setSelected((prev) => prev.filter((s) => s.id !== id));

  const clearSelect = () => setSelected([]);

  const reorderSelect = (from: number, to: number) => {
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
        onToggle={toggleSelect}
        onRemove={removeSelect}
        onClear={clearSelect}
        onReorder={reorderSelect}
        onPlay={play}
      />
      {mode === 'play' && selected.length > 0 && (
        <SlideshowPlayer slides={selected} onExit={() => setMode('build')} />
      )}
    </div>
  );
};

export default PatientSlideshow;
