/**
 * Pair slideshow: steps through every photo type available in BOTH selected
 * timepoints, fullscreen while active. Fullscreen entry is best-effort — the
 * slideshow still works inline if the browser denies it; exiting fullscreen
 * via Esc / system gesture ends the slideshow (mirrors the old behavior).
 */

import { useCallback, useEffect, useState } from 'react';
import type { PhotoType } from './types';
import type { ComparisonEngine } from './ComparisonEngine';

interface Options {
    availablePhotoTypes: PhotoType[];
    setSelectedPhotoType: (id: string) => void;
    engine: ComparisonEngine | null;
    enterFullscreen: () => Promise<void>;
    exitFullscreen: () => Promise<void>;
}

export interface SlideshowState {
    active: boolean;
    index: number;
    total: number;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    step: (delta: 1 | -1) => void;
}

export function useSlideshow({
    availablePhotoTypes,
    setSelectedPhotoType,
    engine,
    enterFullscreen,
    exitFullscreen,
}: Options): SlideshowState {
    const [active, setActive] = useState(false);
    const [index, setIndex] = useState(0);

    const start = useCallback(async () => {
        if (availablePhotoTypes.length === 0) return;
        setIndex(0);
        setSelectedPhotoType(availablePhotoTypes[0].id);
        engine?.reset();
        setActive(true);
        await enterFullscreen();
    }, [availablePhotoTypes, setSelectedPhotoType, engine, enterFullscreen]);

    const step = useCallback((delta: 1 | -1) => {
        const next = index + delta;
        if (next < 0 || next >= availablePhotoTypes.length) return;
        setIndex(next);
        engine?.reset();
        setSelectedPhotoType(availablePhotoTypes[next].id);
    }, [index, availablePhotoTypes, engine, setSelectedPhotoType]);

    const stop = useCallback(async () => {
        setActive(false);
        await exitFullscreen();
    }, [exitFullscreen]);

    // System gesture / F11 exit while the slideshow was active: end it too.
    useEffect(() => {
        const onChange = () => {
            if (!document.fullscreenElement) setActive(false);
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    return { active, index, total: availablePhotoTypes.length, start, stop, step };
}
