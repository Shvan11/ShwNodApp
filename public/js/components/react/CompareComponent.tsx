/**
 * CompareComponent — before/after photo comparison for a patient.
 *
 * Orchestrator only: data fetching (timepoints + each selected session's gallery),
 * selection state and wiring. The pieces live in ./compare:
 *   - ComparisonEngine (imperative canvas controller, read via snapshot)
 *   - CompareStage (dark lightbox: canvas, overlay, toolbar, slideshow chrome)
 *   - SelectionPanel / ControlsPanel (workflow rail)
 *   - useCompareShare / useSlideshow
 *
 * Mounted with `key={personId}` (ContentRenderer), so nothing here survives a change
 * of patient.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { brandingQuery, galleryQuery, timepointsQuery } from '@/query/queries';
import type { GalleryResponse, TimepointRow } from '@shared/contracts/patient.contract';
import { parseLocalDate } from '@/utils/calendarDate';
import ShareSheet from './share/ShareSheet';
import { useFullscreen } from './slideshow/useFullscreen';
import { PHOTO_TYPES, type PhotoType } from './compare/types';
import { PairLoadError } from './compare/ComparisonEngine';
import { useComparisonEngine } from './compare/useComparisonEngine';
import { useCompareShare, nativeSharePreferred } from './compare/useCompareShare';
import { useSlideshow } from './compare/useSlideshow';
import CompareStage from './compare/CompareStage';
import ControlsPanel from './compare/ControlsPanel';
import SelectionPanel from './compare/SelectionPanel';
import styles from './CompareComponent.module.css';

interface Props {
    personId?: number | null;
}

/** A session's gallery: undefined while loading, null when its read failed. */
type Galleries = Record<string, GalleryResponse | null | undefined>;

/** "Initial (21 Oct 2024)" — for messages and the canvas's accessible name. */
const sessionLabel = (tp: TimepointRow): string =>
    `${tp.tp_description} (${parseLocalDate(tp.tp_date_time).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })})`;

const CompareComponent = ({ personId }: Props) => {
    const toast = useToast();
    const [selectedTimepoints, setSelectedTimepoints] = useState<string[]>([]);
    const [selectedPhotoType, setSelectedPhotoType] = useState('');
    const [canvasSizeMode, setCanvasSizeMode] = useState('auto');
    const [failedKey, setFailedKey] = useState<string | null>(null);

    const { engine, snap, canvasRef, canvasEl } = useComparisonEngine();
    const stageRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, isOverlay, enter: enterFullscreen, exit: exitFullscreen } = useFullscreen(stageRef);
    const share = useCompareShare(engine, personId);

    // The watermark is this install's own logo (Settings → General), or none (FE-F13-7).
    const { data: branding } = useQuery(brandingQuery());
    const logoUrl = branding?.logo ?? null;
    useEffect(() => {
        void engine?.setLogo(logoUrl);
    }, [engine, logoUrl]);

    // The server lists sessions by DATE (then code) — that order is the treatment's,
    // and it decides Before/After below.
    const {
        data: timepointsData,
        isLoading: timepointsLoading,
        error: timepointsError,
        refetch: refetchTimepoints,
    } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const timepoints: TimepointRow[] = timepointsData ?? [];

    // Each selected session's GALLERY — the same read the grid, the editor and the
    // slideshow use. It names the file that is actually on disk (lower case for the
    // editor's renders, upper case for Dolphin's) and its mtime. Compare used to rebuild
    // `/DolImgs/{id}0{tp}.I{code}` from the DB's view list, which 404'd every native
    // render on a case-sensitive volume (FE-F13-5), listed views whose file was gone
    // (FE-F13-8), and carried no version, so a re-rendered photo stayed stale for a
    // year behind the immutable cache header (FE-F13-1).
    //
    // `combine` is load-bearing, not just tidy: it runs React Query's replaceEqualDeep
    // structural sharing on the output, so `galleries` keeps a STABLE reference across
    // renders while its content is unchanged. Without it, useQueries hands back a fresh
    // array every render, and the load effect below would spin into a render loop
    // (the 2026-06-15 tab freeze — see [[usequeries-combine-referential-stability]]).
    const galleries = useQueries({
        queries: selectedTimepoints.map((tp) => ({
            ...galleryQuery(personId ?? '', tp),
            enabled: !!personId,
        })),
        combine: (results): Galleries => {
            const rec: Galleries = {};
            selectedTimepoints.forEach((tp, i) => {
                const result = results[i];
                if (result?.data) rec[tp] = result.data;
                else if (result?.isError) rec[tp] = null;
            });
            return rec;
        },
    });

    useEffect(() => {
        if (timepointsError) {
            toast.error(httpErrorMessage(timepointsError, 'Failed to load timepoints'));
        }
    }, [timepointsError, toast]);

    // Auto-select the FIRST and LAST session by date, once. The old rule skipped
    // tp_code 0 as if it were a placeholder, but 0 is a patient's first session (the
    // allocator starts there): every patient with three or more sessions opened without
    // their Initial photos, and some on a pair that shared no view at all (FE-F13-2).
    // Render-phase state adjustment; the guard flips in the same pass.
    const [autoSelected, setAutoSelected] = useState(false);
    if (!autoSelected && timepointsData) {
        setAutoSelected(true);
        if (timepointsData.length >= 2) {
            setSelectedTimepoints([timepointsData[0].tp_code, timepointsData[timepointsData.length - 1].tp_code]);
        }
    }

    // The selected pair IN DATE ORDER: Before, then After (FE-F13-3 — sorting the codes
    // as numbers put a re-dated session on the wrong side).
    const pair = timepoints.filter((tp) => selectedTimepoints.includes(tp.tp_code));
    const pairChosen = pair.length === 2;

    // A view is comparable only when BOTH sessions' galleries have its file.
    const isViewAvailable = (photoType: PhotoType): boolean =>
        pairChosen && pair.every((tp) => !!galleries[tp.tp_code]?.[photoType.view]);
    const availablePhotoTypes = PHOTO_TYPES.filter(isViewAvailable);

    const slideshow = useSlideshow({
        availablePhotoTypes,
        setSelectedPhotoType,
        engine,
        enterFullscreen,
        exitFullscreen,
    });

    const handleTimepointSelection = (tpCode: string, checked: boolean) => {
        if (checked) {
            if (selectedTimepoints.length >= 2) {
                toast.warning('You can only select two timepoints for comparison');
                return;
            }
            setSelectedTimepoints([...selectedTimepoints, tpCode]);
        } else {
            setSelectedTimepoints(selectedTimepoints.filter((tp) => tp !== tpCode));
        }
    };

    // Clear the photo type when the pair is KNOWN to lack it (both galleries loaded,
    // one without the view). A still-loading gallery does not clear it.
    const currentPhotoType = PHOTO_TYPES.find((p) => p.id === selectedPhotoType);
    if (
        currentPhotoType &&
        pair.some((tp) => {
            const g = galleries[tp.tp_code];
            return g === null || (g !== undefined && !g[currentPhotoType.view]);
        })
    ) {
        setSelectedPhotoType('');
    }

    // What should be on the canvas: both photos' URLs, versioned by mtime, under a key
    // that changes whenever the selection or a file does. Null while the selection is
    // incomplete or a gallery is still loading.
    const before = pair[0];
    const after = pair[1];
    const beforeView = before && currentPhotoType ? galleries[before.tp_code]?.[currentPhotoType.view] : null;
    const afterView = after && currentPhotoType ? galleries[after.tp_code]?.[currentPhotoType.view] : null;
    const urls: [string, string] | null =
        beforeView && afterView
            ? [`/DolImgs/${beforeView.name}?v=${beforeView.mtime}`, `/DolImgs/${afterView.name}?v=${afterView.mtime}`]
            : null;
    const pairKey = urls && currentPhotoType ? `${currentPhotoType.view}|${urls[0]}|${urls[1]}` : null;

    // Load the pair, or CLEAR the canvas when there is no complete pair — it used to
    // keep the previous pair under an incomplete selection, and Save exported it
    // (FE-F13-4).
    useEffect(() => {
        if (!engine) return;
        if (!pairKey || !urls || !currentPhotoType) {
            engine.clear();
            return;
        }
        if (engine.getSnapshot().sourceKey === pairKey) return;
        let cancelled = false;
        engine.loadPair(urls, { key: pairKey, view: currentPhotoType.view }).catch((err: unknown) => {
            if (cancelled) return;
            setFailedKey(pairKey);
            const which = err instanceof PairLoadError ? pair[err.index] : null;
            toast.error(
                which
                    ? `Couldn't load the ${currentPhotoType.short} photo of ${sessionLabel(which)}.`
                    : `Couldn't load the ${currentPhotoType.short} photos.`
            );
        });
        return () => {
            cancelled = true;
        };
        // `urls`/`pair` are derived from `pairKey`'s inputs; the key alone decides a reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine, pairKey]);

    // Keyboard: slideshow navigation while active, Esc deselects otherwise — but not
    // while a dialog (the share sheet) is on top: Escape closes that, and used to clear
    // the canvas target as well (FE-F13-14d).
    const { active: slideshowActive, step: slideshowStep, stop: slideshowStop } = slideshow;
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (document.querySelector('#modal-root [role="dialog"]')) return;
            if (slideshowActive) {
                if (e.key === 'ArrowRight') { e.preventDefault(); slideshowStep(1); return; }
                if (e.key === 'ArrowLeft')  { e.preventDefault(); slideshowStep(-1); return; }
                if (e.key === 'Escape')     { e.preventDefault(); void slideshowStop(); return; }
            } else if (e.key === 'Escape') {
                engine?.setSelectedImage(0);
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [slideshowActive, slideshowStep, slideshowStop, engine]);

    const toggleFullscreen = () => {
        void (isFullscreen ? exitFullscreen() : enterFullscreen());
    };

    if (timepointsLoading && timepoints.length === 0) {
        return (
            <div className="loading-spinner">
                Loading compare page...
            </div>
        );
    }

    const isReady = !!pairKey && snap.sourceKey === pairKey && !snap.loading;
    const canSlideshow = pairChosen && availablePhotoTypes.length > 0;

    const emptyHint =
        selectedTimepoints.length === 0 ? 'Select two timepoints in the panel to begin'
        : selectedTimepoints.length === 1 ? 'Select one more timepoint'
        : !selectedPhotoType ? 'Now choose a photo type'
        : pairKey && failedKey === pairKey ? "These photos couldn't be loaded — choose another photo type or timepoint"
        : 'Loading images…';

    const steps = [
        { label: 'Timepoints', done: pairChosen, current: !pairChosen },
        { label: 'Photo type', done: pairChosen && !!selectedPhotoType, current: pairChosen && !selectedPhotoType },
        { label: 'Compare & export', done: isReady, current: pairChosen && !!selectedPhotoType && !isReady },
    ];

    const canvasLabel =
        isReady && before && after && currentPhotoType
            ? `${currentPhotoType.label}: ${sessionLabel(before)} above, ${sessionLabel(after)} below`
            : 'Photo comparison';

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headingGroup}>
                    <h2 className={styles.heading}>Photo Comparison</h2>
                    <p className={styles.subheading}>Side-by-side treatment progress between two timepoints</p>
                </div>
                <ol className={styles.stepper} aria-label="Comparison workflow">
                    {steps.map((step, i) => (
                        <li
                            key={step.label}
                            className={styles.stepItem}
                            aria-current={step.current ? 'step' : undefined}
                        >
                            {i > 0 && <span className={styles.stepConnector} aria-hidden="true" />}
                            <span
                                className={cn(
                                    styles.stepChip,
                                    step.done && styles.stepChipDone,
                                    step.current && styles.stepChipCurrent,
                                )}
                            >
                                <span className={styles.stepIndex}>{step.done ? '✓' : i + 1}</span>
                                {step.label}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>

            <div className={styles.layout}>
                <CompareStage
                    engine={engine}
                    snap={snap}
                    canvasRef={canvasRef}
                    canvasEl={canvasEl}
                    canvasLabel={canvasLabel}
                    stageRef={stageRef}
                    isFullscreen={isFullscreen}
                    isOverlay={isOverlay}
                    onToggleFullscreen={toggleFullscreen}
                    emptyHint={emptyHint}
                    onShare={() => void share.handleShareClick()}
                    shareDisabled={!isReady || share.staging}
                    nativeShare={nativeSharePreferred}
                    slideshow={slideshow}
                    canSlideshow={canSlideshow}
                    slideLabel={slideshow.active ? availablePhotoTypes[slideshow.index]?.label : undefined}
                />

                <div className={styles.rail}>
                    <SelectionPanel
                        timepoints={timepoints}
                        pair={pair}
                        selectedTimepoints={selectedTimepoints}
                        onToggleTimepoint={handleTimepointSelection}
                        selectedPhotoType={selectedPhotoType}
                        onSelectPhotoType={setSelectedPhotoType}
                        isViewAvailable={isViewAvailable}
                        loadError={timepointsError ? httpErrorMessage(timepointsError, 'Failed to load timepoints') : null}
                        onRetry={() => void refetchTimepoints()}
                    />
                    <ControlsPanel
                        engine={engine}
                        snap={snap}
                        canvasSizeMode={canvasSizeMode}
                        onCanvasSizeModeChange={(value) => {
                            setCanvasSizeMode(value);
                            engine?.setSizeMode(value);
                        }}
                        onSave={() => void share.handleSave()}
                        onShare={() => void share.handleShareClick()}
                        shareStaging={share.staging}
                        nativeShare={nativeSharePreferred}
                        isReady={isReady}
                    />
                </div>
            </div>

            <ShareSheet
                open={!!share.shareSources}
                sources={share.shareSources ?? []}
                onClose={share.closeShareSheet}
            />
        </div>
    );
};

export default CompareComponent;
