/**
 * CompareComponent — before/after photo comparison for a patient.
 *
 * Orchestrator only: data fetching (timepoints + per-timepoint image lists),
 * selection state and wiring. The pieces live in ./compare:
 *   - ComparisonEngine (imperative canvas controller, read via snapshot)
 *   - CompareStage (dark lightbox: canvas, overlay, toolbar, slideshow chrome)
 *   - SelectionPanel / ControlsPanel (workflow rail)
 *   - useCompareShare / useSlideshow
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import { timepointsQuery } from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import ShareSheet from './share/ShareSheet';
import { useFullscreen } from './slideshow/useFullscreen';
import type { Timepoint } from './compare/types';
import { PHOTO_TYPES } from './compare/types';
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

const CompareComponent = ({ personId }: Props) => {
    const toast = useToast();
    const [selectedTimepoints, setSelectedTimepoints] = useState<number[]>([]);
    const [selectedPhotoType, setSelectedPhotoType] = useState('');
    const [timepointImages, setTimepointImages] = useState<Record<number, string[]>>({});
    const [canvasSizeMode, setCanvasSizeMode] = useState('auto');

    const { engine, snap, canvasRef, canvasEl } = useComparisonEngine();
    const stageRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, enter: enterFullscreen, exit: exitFullscreen } = useFullscreen(stageRef);
    const share = useCompareShare(engine, personId);

    // Timepoint list read — on useQuery, lazy-gated by `!!personId`. Reuses the
    // shared factory + contract schema.
    const {
        data: timepointsData,
        isLoading: timepointsLoading,
        error: timepointsError,
    } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: !!personId,
    });

    // Loose contract models only key fields, so cast to the local Timepoint shape.
    const timepoints = useMemo(
        () => (timepointsData as unknown as Timepoint[] | undefined) ?? [],
        [timepointsData],
    );

    useEffect(() => {
        if (timepointsError) {
            toast.error(httpErrorMessage(timepointsError, 'Failed to load timepoints'));
        }
    }, [timepointsError, toast]);

    // Returns the list of image codes ('10','12',...) available for the given timepoint.
    // Empty array on failure — callers use it to disable photo types whose image is missing.
    const fetchTimepointImages = useCallback(async (tpCode: number): Promise<string[]> => {
        try {
            return await fetchJSON<string[]>(`/api/patients/${personId}/timepoints/${tpCode}/images`, { schema: patientContract.timepointImages.response });
        } catch {
            return [];
        }
    }, [personId]);

    // Auto-select first/last timepoint (skip tp_code 0) once per patient, the
    // moment their timepoint list is on hand. Render-phase state adjustment
    // (the docs' "adjusting state when a prop changes" pattern) — the guard
    // flips in the same pass, so this never loops. Also resets per-patient
    // caches so a previous patient's image lists can't leak across (tp codes
    // are only unique within a patient).
    const [autoSelectedFor, setAutoSelectedFor] = useState<number | null | undefined>(undefined);
    if (timepoints.length > 0 && autoSelectedFor !== (personId ?? null)) {
        setAutoSelectedFor(personId ?? null);
        setTimepointImages({});
        setSelectedPhotoType('');

        let autoSelected: number[] = [];
        if (timepoints.length >= 2) {
            const validTimepoints = timepoints.filter(tp => tp.tp_code > 0);
            if (validTimepoints.length >= 2) {
                autoSelected = [validTimepoints[0].tp_code, validTimepoints[validTimepoints.length - 1].tp_code];
            } else if (validTimepoints.length === 1) {
                autoSelected = [timepoints[0].tp_code, timepoints[1].tp_code];
            }
        }
        setSelectedTimepoints(autoSelected);
    }

    // Fetch the image-code list for any selected timepoint that doesn't have
    // one yet (covers both auto-select and manual toggles). While an entry is
    // missing, photo types stay disabled — see isPhotoTypeAvailable.
    useEffect(() => {
        const missing = selectedTimepoints.filter(tp => !(tp in timepointImages));
        if (missing.length === 0) return;
        let cancelled = false;
        void Promise.all(missing.map(tp => fetchTimepointImages(tp))).then(results => {
            if (cancelled) return;
            setTimepointImages(prev => {
                const next = { ...prev };
                missing.forEach((tp, i) => { next[tp] = results[i]; });
                return next;
            });
        });
        return () => { cancelled = true; };
    }, [selectedTimepoints, timepointImages, fetchTimepointImages]);

    // A pair is selectable only when the image exists in EVERY selected timepoint.
    // A pending fetch (no entry in timepointImages yet) correctly disables the pair
    // until the fetch resolves — see fetchTimepointImages which returns [] on failure.
    const isPhotoTypeAvailable = useCallback((photoCode: string): boolean => {
        if (selectedTimepoints.length === 0) return true;
        return selectedTimepoints.every(tpCode => {
            const images = timepointImages[tpCode];
            return Array.isArray(images) && images.includes(photoCode);
        });
    }, [selectedTimepoints, timepointImages]);

    const availablePhotoTypes = useMemo(
        () => PHOTO_TYPES.filter(p => {
            if (selectedTimepoints.length === 0) return false;
            return selectedTimepoints.every(tpCode => {
                const images = timepointImages[tpCode];
                return Array.isArray(images) && images.includes(p.code);
            });
        }),
        [selectedTimepoints, timepointImages]
    );

    const slideshow = useSlideshow({
        availablePhotoTypes,
        setSelectedPhotoType,
        engine,
        enterFullscreen,
        exitFullscreen,
    });

    const handleTimepointSelection = (tpCode: number, checked: boolean) => {
        if (checked) {
            if (selectedTimepoints.length >= 2) {
                toast.warning('You can only select two timepoints for comparison');
                return;
            }
            setSelectedTimepoints([...selectedTimepoints, tpCode]);
        } else {
            setSelectedTimepoints(selectedTimepoints.filter(tp => tp !== tpCode));
        }
    };

    // Clear selectedPhotoType when a changed timepoint selection is KNOWN to
    // lack the chosen type (its fetched list excludes the code) — prevents the
    // canvas from requesting a missing image (404). A still-pending list does
    // NOT clear: the load effect below also waits for confirmed availability.
    // Render-phase adjustment; the guard flips in the same pass.
    const currentPhotoType = PHOTO_TYPES.find(p => p.id === selectedPhotoType);
    if (currentPhotoType && selectedTimepoints.some(tp => {
        const images = timepointImages[tp];
        return Array.isArray(images) && !images.includes(currentPhotoType.code);
    })) {
        setSelectedPhotoType('');
    }

    // Load the comparison images once a complete selection exists AND every
    // selected timepoint's fetched image list confirms the type is present.
    // The engine swaps image sets atomically and tracks its own loading flag.
    useEffect(() => {
        if (!engine || selectedTimepoints.length !== 2 || !selectedPhotoType) return;
        const photoType = PHOTO_TYPES.find(p => p.id === selectedPhotoType);
        if (!photoType) return;
        const confirmed = selectedTimepoints.every(tp => timepointImages[tp]?.includes(photoType.code));
        if (!confirmed) return;
        const sorted = [...selectedTimepoints].sort((a, b) => a - b);
        const suffix = `.I${photoType.code}`;
        const urls = [
            `/DolImgs/${personId}0${sorted[0]}${suffix}`,
            `/DolImgs/${personId}0${sorted[1]}${suffix}`,
            '/images/logo_white.png',
        ];
        let cancelled = false;
        engine.loadImages(urls).catch((err: unknown) => {
            if (!cancelled) {
                toast.error('Failed to load comparison images: ' + (err instanceof Error ? err.message : 'Unknown error'));
            }
        });
        return () => { cancelled = true; };
    }, [engine, selectedTimepoints, selectedPhotoType, timepointImages, personId, toast]);

    // Keyboard: slideshow navigation while active, Esc deselects otherwise.
    const { active: slideshowActive, step: slideshowStep, stop: slideshowStop } = slideshow;
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
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

    const pairChosen = selectedTimepoints.length === 2;
    const isReady = pairChosen && Boolean(selectedPhotoType);
    const canSlideshow = pairChosen && availablePhotoTypes.length > 0;

    const emptyHint =
        selectedTimepoints.length === 0 ? 'Select two timepoints in the panel to begin'
        : selectedTimepoints.length === 1 ? 'Select one more timepoint'
        : !selectedPhotoType ? 'Now choose a photo type'
        : 'Loading images…';

    const steps = [
        { label: 'Timepoints', done: pairChosen, current: !pairChosen },
        { label: 'Photo type', done: isReady, current: pairChosen && !isReady },
        { label: 'Compare & export', done: snap.imageCount >= 2, current: isReady && snap.imageCount < 2 },
    ];

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headingGroup}>
                    <h2 className={styles.heading}>Photo Comparison</h2>
                    <p className={styles.subheading}>Side-by-side treatment progress between two timepoints</p>
                </div>
                <div className={styles.stepper} aria-label="Comparison workflow">
                    {steps.map((step, i) => (
                        <React.Fragment key={step.label}>
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
                        </React.Fragment>
                    ))}
                </div>
            </div>

            <div className={styles.layout}>
                <CompareStage
                    engine={engine}
                    snap={snap}
                    canvasRef={canvasRef}
                    canvasEl={canvasEl}
                    stageRef={stageRef}
                    isFullscreen={isFullscreen}
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
                        selectedTimepoints={selectedTimepoints}
                        onToggleTimepoint={(tp, checked) => void handleTimepointSelection(tp, checked)}
                        selectedPhotoType={selectedPhotoType}
                        onSelectPhotoType={setSelectedPhotoType}
                        isPhotoTypeAvailable={isPhotoTypeAvailable}
                    />
                    <ControlsPanel
                        engine={engine}
                        snap={snap}
                        canvasSizeMode={canvasSizeMode}
                        onCanvasSizeModeChange={(value) => {
                            setCanvasSizeMode(value);
                            engine?.setSizeMode(value);
                        }}
                        onSave={share.handleSave}
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
