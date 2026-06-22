import styles from './PeriodNavigator.module.css';

// Local-wall-clock YYYY-MM-DD helpers (single-clinic dates, no UTC shift).
const pad2 = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

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
        const [y, m] = startDate.split('-').map(Number);
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
                <input
                    id={`${idPrefix}-start`}
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(e) => onChange(e.target.value, endDate)}
                />
            </div>

            <i className={`fas fa-arrow-right ${styles.arrow}`} aria-hidden="true"></i>

            <div className={styles.periodField}>
                <label htmlFor={`${idPrefix}-end`}>To</label>
                <input
                    id={`${idPrefix}-end`}
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => onChange(startDate, e.target.value)}
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
