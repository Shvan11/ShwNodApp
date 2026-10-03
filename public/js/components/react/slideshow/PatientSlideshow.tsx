/**
 * PatientSlideshow — operator-controlled presentation builder + player.
 *
 * Lets staff hand-pick photos across a single patient's timepoints, arrange the
 * order, then play an immersive, touch-driven slideshow (for chair-side consults
 * and social-media reels). Reads the timepoints and gallery endpoints; saved
 * presentations and the clinic's generic templates live in `slideshow_configs`
 * (`/api/slideshow-configs`). The working sequence is mirrored to sessionStorage
 * so it survives navigating away and back within the session.
 *
 * Mounted with `key={personId}` (ContentRenderer), so nothing — open sessions, the
 * timeline, an in-flight gallery read — carries over to another patient (FE-F15-8).
 *
 * Galleries are React Query reads (`galleryQuery`, shared with the grid and the
 * editor), so a photo saved or removed in the editor reaches this page through the
 * same invalidation. The timeline keeps each photo's IDENTITY; its URL, version and
 * caption are resolved on every render from those reads (FE-F15-4).
 */
import { useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { postJSON, putJSON, deleteJSON } from '@/core/http';
import { galleryQuery, slideshowConfigsQuery, timepointsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import * as slideshowContract from '@shared/contracts/slideshow.contract';
import type { ConfigPayload, ConfigRow } from '@shared/contracts/slideshow.contract';
import type { GalleryResponse } from '@shared/contracts/patient.contract';
import SlideshowBuilder, { type GalleryStatus } from './SlideshowBuilder';
import SlideshowPlayer from './SlideshowPlayer';
import { folderPhoto, galleryPhotos, rebuildLiteral, resolveTemplate, type GetGallery } from './configResolver';
import { slidePhotos, slidePhotoCount, MAX_PHOTOS_PER_SLIDE } from './photoTypes';
import { storedSlide, type SlideItem, type SlidePhoto } from './types';
import { generateId } from '../../../core/utils';
import styles from './PatientSlideshow.module.css';

interface Props {
  personId?: number | null;
}

const sessionKey = (pid: number | null | undefined): string => `slideshow_seq_${pid ?? 'none'}`;

/** The stored timeline, parsed entry by entry — a malformed one is dropped (FE-F15-11). */
function readSession(pid: number | null | undefined): SlideItem[] {
  try {
    const raw = sessionStorage.getItem(sessionKey(pid));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((s) => {
      const r = storedSlide.safeParse(s);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

function writeSession(pid: number | null | undefined, items: SlideItem[]): void {
  try {
    // Identity and captions only — the URLs are rebuilt on every render.
    const lean = items.map(({ thumbUrl: _t, missing: _m, extras, ...rest }) => ({
      ...rest,
      ...(extras ? { extras: extras.map(({ thumbUrl: _t2, missing: _m2, ...e }) => e) } : {}),
    }));
    sessionStorage.setItem(sessionKey(pid), JSON.stringify(lean));
  } catch {
    /* storage disabled / quota — non-fatal */
  }
}

// --- Slide/photo helpers (a slide carries one photo, or up to three when paired) ---
const toPhoto = (item: SlideItem): SlidePhoto => {
  const { uid: _uid, extras: _extras, ...photo } = item;
  return photo;
};

// Wrap a palette photo as a fresh slide instance (unique uid → duplicates allowed).
const newSlide = (photo: SlidePhoto): SlideItem => ({ ...photo, uid: generateId() });

const withoutExtras = (slide: SlideItem): SlideItem => {
  const copy = { ...slide };
  delete copy.extras;
  return copy;
};

const PatientSlideshow = ({ personId }: Props) => {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<SlideItem[]>(() => readSession(personId));
  const [mode, setMode] = useState<'build' | 'play'>('build');
  // Sessions the builder has opened (their galleries are read on first open).
  const [openedTps, setOpenedTps] = useState<string[]>([]);

  const { data: sessionsData, isLoading: loadingTimepoints, isError: timepointsError } = useQuery({
    ...timepointsQuery(personId ?? ''),
    enabled: !!personId,
  });
  const sessions = sessionsData ?? [];

  useEffect(() => {
    if (timepointsError) toast.error('Failed to load photo sessions');
  }, [timepointsError, toast]);

  useEffect(() => {
    writeSession(personId, selected);
  }, [personId, selected]);

  // Every gallery this page needs: the sessions opened in the builder, plus every
  // session the timeline uses (so its photos resolve to their current version).
  const timelineTps = selected
    .flatMap(slidePhotos)
    .filter((p) => p.source !== 'folder' && p.tp)
    .map((p) => p.tp);
  const neededTps = [...new Set([...openedTps, ...timelineTps])];
  // `combine` keeps the result referentially stable while its content is unchanged
  // (replaceEqualDeep) — see [[usequeries-combine-referential-stability]].
  const galleryReads = useQueries({
    queries: neededTps.map((tp) => ({ ...galleryQuery(personId ?? '', tp), enabled: !!personId })),
    combine: (results) => {
      const rec: Record<string, { data?: GalleryResponse; status: GalleryStatus }> = {};
      neededTps.forEach((tp, i) => {
        const r = results[i];
        rec[tp] = { data: r?.data, status: r?.data ? 'ready' : r?.isError ? 'error' : 'loading' };
      });
      return rec;
    },
  });

  // Palette photos per opened session.
  const galleries: Record<string, SlidePhoto[]> = {};
  const galleryStatus: Record<string, GalleryStatus> = {};
  for (const tp of openedTps) {
    const read = galleryReads[tp];
    const session = sessions.find((s) => s.tp_code === tp);
    galleryStatus[tp] = read?.status ?? 'loading';
    galleries[tp] = read?.data && session && personId ? galleryPhotos(personId, session, read.data) : [];
  }

  // The timeline as it is NOW: each gallery photo takes its current URL, version and
  // caption from its session's gallery; one whose file or session is gone is marked
  // `missing`. Folder photos rebuild their URL from the path.
  const resolvePhoto = (p: SlidePhoto): SlidePhoto => {
    if (!personId) return p;
    if (p.source === 'folder' && p.path) return folderPhoto(personId, p.path, p.name);
    const session = sessions.find((s) => s.tp_code === p.tp);
    const read = galleryReads[p.tp];
    if (sessionsData && !session) return { ...p, missing: true };
    if (!session || !read?.data) return p; // still loading: keep what we have
    const now = galleryPhotos(personId, session, read.data).find((g) => g.name.toLowerCase() === p.name.toLowerCase());
    return now ?? { ...p, missing: true };
  };
  const resolved: SlideItem[] = selected.map((s) => ({
    ...s,
    ...resolvePhoto(s),
    uid: s.uid,
    ...(s.extras ? { extras: s.extras.map(resolvePhoto) } : {}),
  }));

  // Saved configs: this patient's sequences + the clinic-wide generic templates.
  const { data: configsData } = useQuery({
    ...slideshowConfigsQuery(personId ?? ''),
    enabled: !!personId,
  });
  const configs: ConfigRow[] = configsData ?? [];

  // A template is in EVERY patient's list, so a write refreshes them all — another
  // patient's page kept a deleted template for its 30 s staleTime (FE-F15-7).
  const createMut = useApiMutation({
    mutationFn: (body: slideshowContract.CreateConfigBody) =>
      postJSON<ConfigRow, slideshowContract.CreateConfigBody>('/api/slideshow-configs', body, {
        schema: slideshowContract.createConfig.response,
      }),
    invalidate: () => [qk.slideshow.all()],
  });
  const renameMut = useApiMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      putJSON<ConfigRow, { name: string }>(`/api/slideshow-configs/${id}`, { name }, {
        schema: slideshowContract.updateConfig.response,
      }),
    invalidate: () => [qk.slideshow.all()],
  });
  const deleteMut = useApiMutation({
    mutationFn: (id: number) =>
      deleteJSON<{ id: number }>(`/api/slideshow-configs/${id}`, { schema: slideshowContract.deleteConfig.response }),
    invalidate: () => [qk.slideshow.all()],
  });

  const openSession = (tp: string): void => {
    setOpenedTps((prev) => (prev.includes(tp) ? prev : [...prev, tp]));
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

  // Tray chip ✕ removes that one instance (every photo of a pair); use unpair to split.
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

  // Play what still exists: a photo that is gone is skipped, and the user told.
  const playable: SlideItem[] = resolved.flatMap((s) => {
    const photos = slidePhotos(s).filter((p) => !p.missing);
    if (photos.length === 0) return [];
    const [primary, ...extras] = photos;
    return [{ ...primary, uid: s.uid, ...(extras.length ? { extras } : {}) }];
  });
  const missingCount = resolved.flatMap(slidePhotos).filter((p) => p.missing).length;

  const play = () => {
    if (playable.length === 0) {
      if (selected.length > 0) toast.error('None of the photos in the timeline exist any more');
      return;
    }
    if (missingCount > 0) {
      toast.info(`${missingCount} photo${missingCount === 1 ? '' : 's'} no longer exist${missingCount === 1 ? 's' : ''} and will be skipped`);
    }
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

  // One gallery for the resolvers, read FRESH: applying is a deliberate act, and a
  // cached gallery (up to its staleTime old) could still list a photo that was
  // removed from another desk — the apply would then say nothing was missing.
  const getGallery: GetGallery = (tp) =>
    personId
      ? queryClient.fetchQuery({ ...galleryQuery(personId, tp), staleTime: 0 }).catch(() => null)
      : Promise.resolve(null);

  // Resolve a config to slides and replace the timeline, against the patient's
  // sessions and galleries as they are now; photos that are gone are skipped and
  // counted, for saved presentations as for templates (FE-F15-4b).
  const doApply = async (row: ConfigRow): Promise<void> => {
    if (personId == null) return;
    try {
      const result =
        row.config.kind === 'literal'
          ? { ...(await rebuildLiteral(row.config, personId, sessions, getGallery)), sameSession: 0 }
          : await resolveTemplate(row.config, personId, sessions, getGallery);
      if (result.slides.length === 0) {
        toast.error(
          result.sameSession > 0
            ? `“${row.name}” compares two sessions, and this patient has only one with these photos`
            : `“${row.name}” has no matching photos for this patient`
        );
        return;
      }
      setSelected(result.slides);
      const notes = [
        result.missing > 0 ? `${result.missing} photo${result.missing === 1 ? '' : 's'} not available` : '',
        result.sameSession > 0
          ? `${result.sameSession} before/after slide${result.sameSession === 1 ? '' : 's'} skipped (only one session has the photo)`
          : '',
      ].filter(Boolean);
      if (notes.length) toast.info(`Applied “${row.name}” — ${notes.join('; ')}`);
      else toast.success(`Applied “${row.name}”`);
    } catch {
      toast.error('Failed to build the presentation from this configuration');
    }
  };

  // Confirm before replacing a non-empty timeline.
  const requestApply = async (row: ConfigRow): Promise<void> => {
    if (selected.length > 0) {
      const ok = await confirm(
        `Applying “${row.name}” will replace the ${selected.length} photo${selected.length === 1 ? '' : 's'} currently in your timeline.`,
        { title: 'Replace current timeline?', confirmText: 'Replace' }
      );
      if (!ok) return;
    }
    await doApply(row);
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
        timepoints={sessions}
        loadingTimepoints={loadingTimepoints}
        galleries={galleries}
        galleryStatus={galleryStatus}
        onOpenSession={openSession}
        selected={resolved}
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
        onApplyConfig={(row) => void requestApply(row)}
        onSaveConfig={handleSaveConfig}
        onRenameConfig={handleRenameConfig}
        onDeleteConfig={handleDeleteConfig}
      />
      {mode === 'play' && playable.length > 0 && (
        <SlideshowPlayer slides={playable} onExit={() => setMode('build')} />
      )}
    </div>
  );
};

export default PatientSlideshow;
