import { useEffect, useRef, useState } from 'react';
import styles from './StatsCards.module.css';

interface StatsCardsProps {
    total?: number;
    checkedIn?: number;
    absent?: number;
    waiting?: number;
    /** 'cards' = standalone row (default); 'header' = compact chips embedded in the appointments header bar */
    variant?: 'cards' | 'header';
}

interface StatValues {
    total: number;
    checkedIn: number;
    absent: number;
    waiting: number;
}

/**
 * StatsCards Component
 * Displays statistics with animated count-up effect
 *
 * Performance: Automatically optimized by React Compiler (React 19).
 * No manual memoization needed - the compiler handles it automatically.
 */
const StatsCards = ({ total = 0, checkedIn = 0, absent = 0, waiting = 0, variant = 'cards' }: StatsCardsProps) => {
    const [animatedTotal, setAnimatedTotal] = useState<number>(0);
    const [animatedCheckedIn, setAnimatedCheckedIn] = useState<number>(0);
    const [animatedAbsent, setAnimatedAbsent] = useState<number>(0);
    const [animatedWaiting, setAnimatedWaiting] = useState<number>(0);

    // The value actually on screen right now: a re-triggered animation resumes
    // from here, and the effect guard compares against it. Don't guard on a
    // "previous props" ref — StrictMode runs setup→cleanup→setup, the cleanup
    // kills the timers mid-count, and a props-based guard then skips the second
    // setup, freezing the chips at 0.
    const displayed = useRef<StatValues>({ total: 0, checkedIn: 0, absent: 0, waiting: 0 });

    // Animate value changes
    useEffect(() => {
        const animateValue = (
            key: keyof StatValues,
            setValue: React.Dispatch<React.SetStateAction<number>>,
            end: number,
            duration: number = 300
        ): ReturnType<typeof setInterval> => {
            const start = displayed.current[key];
            const range = end - start;
            const increment = range / (duration / 16);
            let current = start;

            const timer = setInterval(() => {
                current += increment;
                if ((increment >= 0 && current >= end) || (increment < 0 && current <= end)) {
                    displayed.current[key] = end;
                    setValue(end);
                    clearInterval(timer);
                } else {
                    const rounded = Math.round(current);
                    displayed.current[key] = rounded;
                    setValue(rounded);
                }
            }, 16);

            return timer;
        };

        const timers: ReturnType<typeof setInterval>[] = [];

        if (displayed.current.total !== total) {
            timers.push(animateValue('total', setAnimatedTotal, total));
        }

        if (displayed.current.checkedIn !== checkedIn) {
            timers.push(animateValue('checkedIn', setAnimatedCheckedIn, checkedIn));
        }

        if (displayed.current.absent !== absent) {
            timers.push(animateValue('absent', setAnimatedAbsent, absent));
        }

        if (displayed.current.waiting !== waiting) {
            timers.push(animateValue('waiting', setAnimatedWaiting, waiting));
        }

        return () => {
            timers.forEach(timer => clearInterval(timer));
        };
    }, [total, checkedIn, absent, waiting]);

    const isHeader = variant === 'header';
    const containerClass = isHeader ? styles.headerContainer : styles.container;
    // "Total Appointments" is too wide for the inline header chip — trim it there.
    const totalLabel = isHeader ? 'Total' : 'Total Appointments';

    return (
        <div className={containerClass}>
            <div className={styles.cardTotal}>
                <div className={styles.icon}>
                    <i className="fas fa-calendar-check"></i>
                </div>
                <div className={styles.content}>
                    <div className={styles.label}>{totalLabel}</div>
                    <div className={styles.value}>{isNaN(animatedTotal) ? 0 : animatedTotal}</div>
                </div>
            </div>

            <div className={styles.cardPresent}>
                <div className={styles.icon}>
                    <i className="fas fa-user-check"></i>
                </div>
                <div className={styles.content}>
                    <div className={styles.label}>Checked In</div>
                    <div className={styles.value}>{isNaN(animatedCheckedIn) ? 0 : animatedCheckedIn}</div>
                </div>
            </div>

            <div className={styles.cardRemaining}>
                <div className={styles.icon}>
                    <i className="fas fa-user-clock"></i>
                </div>
                <div className={styles.content}>
                    <div className={styles.label}>Remaining</div>
                    <div className={styles.value}>{isNaN(animatedAbsent) ? 0 : animatedAbsent}</div>
                </div>
            </div>

            <div className={styles.cardWaiting}>
                <div className={styles.icon}>
                    <i className="fas fa-clock"></i>
                </div>
                <div className={styles.content}>
                    <div className={styles.label}>Waiting</div>
                    <div className={styles.value}>{isNaN(animatedWaiting) ? 0 : animatedWaiting}</div>
                </div>
            </div>
        </div>
    );
};

export type { StatsCardsProps };
export default StatsCards;
