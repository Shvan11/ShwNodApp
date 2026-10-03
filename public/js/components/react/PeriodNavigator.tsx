import { useState } from 'react';
import { toLocalDateString as ymd } from '../../utils/calendarDate';
import styles from './PeriodNavigator.module.css';

/**
 * A complete date the range can use. A date input reports `0002-10-15` after the
 * first digit of a typed year and '' when cleared; neither is a period anyone
 * means, and each fired an aggregate query or a 400 (audit FE-F5-8).
 */
const isUsableDate = (v: string): boolean => /^(\d{4})-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;

/**
 * A date field that hands the range only a usable date and snaps an unusable
 * draft back to the committed value on blur. (Controlled straight off the prop,
 * an ignored keystroke would also be reverted, and the year could not be typed.)
 */
const DateField = ({ id, value, min, max, onCommit }: {
    id: string;
    value: string;
    min?: string;
    max?: string;
    onCommit: (v: string) => void;
}) => {
    const [draft, setDraft] = useState(value);
    const [shown, setShown] = useState(value);
    if (value !== shown) {
        setShown(value);
        setDraft(value);
    }
    return (
        <input
            id={id}
            type="date"
            value={draft}
            min={min}
            max={max}
            onChange={(e) => {
                setDraft(e.target.value);
                if (isUsableDate(e.target.value) && e.target.value !== value) onCommit(e.target.value);
            }}
            onBlur={() => { if (!isUsableDate(draft)) setDraft(value); }}
        />
    );
};

/** First day of the current calendar month, as YYYY-MM-DD. */
export const currentMonthStart = (): string => {
    const now = new Date();
    return ymd(new Date(now.getFullYear(), now.getMonth(), 1));
};

/** Last day of the current calendar month, as YYYY-MM-DD. (Day 0 of next month.) */
export const currentMonthEnd = (): string => {
    const now = new Date();
    return ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};

interface PeriodNavigatorProps {
    startDate: string;
    endDate: string;
    /** Called with a fresh (start, end) pair on any edit or month step. */
    onChange: (startDate: string, endDate: string) => void;
    /** Show the inline refresh spinner (a fetch is in flight). */
    isFetching?: boolean;
    /** Unique prefix for the input ids / labels so two instances don't collide. */
    idPrefix: string;
}

/**
 * From/To date-range bar with quick whole-month stepping. The chevrons snap the
 * range to the previous / next whole calendar month (taken from the start date),
 * which is the common "step a month at a time" case; the date inputs still allow
 * an arbitrary custom range, and "This Month" returns to the current month.
 */
const PeriodNavigator = ({ startDate, endDate, onChange, isFetching, idPrefix }: PeriodNavigatorProps) => {
    // Jump to the whole calendar month `delta` months from the current start month.
    const stepMonth = (delta: number) => {
        // An unusable start (never committed by DateField, but the prop is the
        // parent's) steps from this month rather than producing NaN-NaN-NaN.
        const base = isUsableDate(startDate) ? startDate : currentMonthStart();
        const [y, m] = base.split('-').map(Number);
        const first = new Date(y, m - 1 + delta, 1);
        const last = new Date(y, m - 1 + delta + 1, 0);
        onChange(ymd(first), ymd(last));
    };

    return (
        <div className={styles.periodBar}>
            <button
                type="button"
                className={styles.navBtn}
                onClick={() => stepMonth(-1)}
                title="Previous month"
                aria-label="Previous month"
            >
                <i className="fas fa-chevron-left" aria-hidden="true"></i>
            </button>

            <div className={styles.periodField}>
                <label htmlFor={`${idPrefix}-start`}>From</label>
                <DateField
                    id={`${idPrefix}-start`}
                    value={startDate}
                    max={endDate || undefined}
                    onCommit={(v) => onChange(v, endDate)}
                />
            </div>

            <i className={`fas fa-arrow-right ${styles.arrow}`} aria-hidden="true"></i>

            <div className={styles.periodField}>
                <label htmlFor={`${idPrefix}-end`}>To</label>
                <DateField
                    id={`${idPrefix}-end`}
                    value={endDate}
                    min={startDate || undefined}
                    onCommit={(v) => onChange(startDate, v)}
                />
            </div>

            <button
                type="button"
                className={styles.navBtn}
                onClick={() => stepMonth(1)}
                title="Next month"
                aria-label="Next month"
            >
                <i className="fas fa-chevron-right" aria-hidden="true"></i>
            </button>

            <button
                type="button"
                className={styles.thisMonthBtn}
                onClick={() => onChange(currentMonthStart(), currentMonthEnd())}
            >
                This Month
            </button>

            {isFetching && (
                <i className={`fas fa-spinner fa-spin ${styles.spinner}`} aria-hidden="true"></i>
            )}
        </div>
    );
};

export default PeriodNavigator;
