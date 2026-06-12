/**
 * Owns the ComparisonEngine lifecycle + exposes its immutable render snapshot.
 *
 * The engine is created in a callback ref the moment the <canvas> mounts (the
 * compare screen renders behind a spinner first, so a mount-time effect would
 * miss it) and torn down when the canvas unmounts. Components re-render via
 * useSyncExternalStore — every engine mutation commits a new snapshot.
 */

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ComparisonEngine, EMPTY_SNAPSHOT, emptySubscribe, getEmptySnapshot } from './ComparisonEngine';
import type { EngineSnapshot } from './ComparisonEngine';

export interface UseComparisonEngineResult {
    engine: ComparisonEngine | null;
    snap: EngineSnapshot;
    /** Attach to the <canvas> element. */
    canvasRef: (canvas: HTMLCanvasElement | null) => void;
    /** Current canvas element (for the overlay's client→canvas mapping). */
    canvasEl: HTMLCanvasElement | null;
}

export function useComparisonEngine(): UseComparisonEngineResult {
    const [engine, setEngine] = useState<ComparisonEngine | null>(null);
    const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
    const engineRef = useRef<ComparisonEngine | null>(null);

    const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
        if (canvas) {
            if (!engineRef.current) {
                const context = canvas.getContext('2d');
                if (!context) return;
                engineRef.current = new ComparisonEngine(canvas, context);
                setEngine(engineRef.current);
                setCanvasEl(canvas);
            }
        } else {
            engineRef.current = null;
            setEngine(null);
            setCanvasEl(null);
        }
    }, []);

    const snap = useSyncExternalStore(
        engine ? engine.subscribe : emptySubscribe,
        engine ? engine.getSnapshot : getEmptySnapshot,
    );

    return { engine, snap: engine ? snap : EMPTY_SNAPSHOT, canvasRef, canvasEl };
}
