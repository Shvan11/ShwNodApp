import { useSyncExternalStore } from 'react';
import { toLocalDateString } from '../utils/calendarDate';

/**
 * The wall clock as React state: `useToday()` (the local 'YYYY-MM-DD') and
 * `useNowMinute()` (epoch ms, floored to the minute).
 *
 * Why not `new Date()` in render: the React Compiler memoizes render code on
 * its reactive inputs, and the clock is not one. A `new Date()` in a block
 * with no dependencies runs once per mount, and one keyed on props reruns only
 * when those props change, so a tab left open past midnight keeps
 * yesterday's "today" highlight, and "5m" stays "5m" (audit FE-F26-2). Reading
 * the clock through this store makes it a dependency like any other.
 *
 * One module-level ticker serves every subscriber and runs only while
 * something is subscribed. `useSyncExternalStore` re-renders a component only
 * when ITS snapshot changes, so a `useToday()` consumer renders once a day,
 * not once a tick.
 */

const TICK_MS = 15_000;

let today = toLocalDateString(new Date());
let nowMinute = floorToMinute(Date.now());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function floorToMinute(ms: number): number {
    return ms - (ms % 60_000);
}

/** Refresh both snapshots; true when either moved. */
function refresh(): boolean {
    const nextToday = toLocalDateString(new Date());
    const nextMinute = floorToMinute(Date.now());
    if (nextToday === today && nextMinute === nowMinute) return false;
    today = nextToday;
    nowMinute = nextMinute;
    return true;
}

function tick(): void {
    if (refresh()) for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    if (timer === null) {
        timer = setInterval(tick, TICK_MS);
        // A sleeping laptop or a background tab can miss ticks for hours.
        document.addEventListener('visibilitychange', tick);
    }
    return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
            document.removeEventListener('visibilitychange', tick);
        }
    };
}

// With no subscriber the ticker is stopped, so the first reader refreshes
// first (there is no one to notify yet). Snapshots are primitives, so two calls
// within one render compare equal.
function getToday(): string {
    if (listeners.size === 0) refresh();
    return today;
}

function getNowMinute(): number {
    if (listeners.size === 0) refresh();
    return nowMinute;
}

/** Today's local date, 'YYYY-MM-DD'. Re-renders at midnight (and on wake). */
export function useToday(): string {
    return useSyncExternalStore(subscribe, getToday);
}

/** Epoch ms floored to the minute. Re-renders once a minute while mounted. */
export function useNowMinute(): number {
    return useSyncExternalStore(subscribe, getNowMinute);
}
