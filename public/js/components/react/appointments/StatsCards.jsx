import { useEffect, useRef, useState } from 'react';

/**
 * StatsCards Component
 * Displays statistics with animated count-up effect
 *
 * Performance: Automatically optimized by React Compiler (React 19).
 * No manual memoization needed - the compiler handles it automatically.
 */
const StatsCards = ({ total = 0, checkedIn = 0, absent = 0, waiting = 0 }) => {
    const [animatedTotal, setAnimatedTotal] = useState(0);
    const [animatedCheckedIn, setAnimatedCheckedIn] = useState(0);
    const [animatedAbsent, setAnimatedAbsent] = useState(0);
    const [animatedWaiting, setAnimatedWaiting] = useState(0);

    const prevValues = useRef({ total: 0, checkedIn: 0, absent: 0, waiting: 0 });

    // Animate value changes
    useEffect(() => {
        const animateValue = (setValue, start, end, duration = 300) => {
            const range = end - start;
            const increment = range / (duration / 16);
            let current = start;

            const timer = setInterval(() => {
                current += increment;
                if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
                    setValue(end);
                    clearInterval(timer);
                } else {
                    setValue(Math.round(current));
                }
            }, 16);

            return timer;
        };

        const timers = [];

        if (prevValues.current.total !== total) {
            timers.push(animateValue(setAnimatedTotal, prevValues.current.total, total));
            prevValues.current.total = total;
        }

        if (prevValues.current.checkedIn !== checkedIn) {
            timers.push(animateValue(setAnimatedCheckedIn, prevValues.current.checkedIn, checkedIn));
            prevValues.current.checkedIn = checkedIn;
        }

        if (prevValues.current.absent !== absent) {
            timers.push(animateValue(setAnimatedAbsent, prevValues.current.absent, absent));
            prevValues.current.absent = absent;
        }

        if (prevValues.current.waiting !== waiting) {
            timers.push(animateValue(setAnimatedWaiting, prevValues.current.waiting, waiting));
            prevValues.current.waiting = waiting;
        }

        return () => {
            timers.forEach(timer => clearInterval(timer));
        };
    }, [total, checkedIn, absent, waiting]);

    return (
        <div className="stats-container">
            <div className="stat-card stat-total">
                <div className="stat-icon">
                    <i className="fas fa-calendar-check"></i>
                </div>
                <div className="stat-content">
                    <div className="stat-label">Total Appointments</div>
                    <div className="stat-value">{isNaN(animatedTotal) ? 0 : animatedTotal}</div>
                </div>
            </div>

            <div className="stat-card stat-present">
                <div className="stat-icon">
                    <i className="fas fa-user-check"></i>
                </div>
                <div className="stat-content">
                    <div className="stat-label">Checked In</div>
                    <div className="stat-value">{isNaN(animatedCheckedIn) ? 0 : animatedCheckedIn}</div>
                </div>
            </div>

            <div className="stat-card stat-absent">
                <div className="stat-icon">
                    <i className="fas fa-user-times"></i>
                </div>
                <div className="stat-content">
                    <div className="stat-label">Absent</div>
                    <div className="stat-value">{isNaN(animatedAbsent) ? 0 : animatedAbsent}</div>
                </div>
            </div>

            <div className="stat-card stat-waiting">
                <div className="stat-icon">
                    <i className="fas fa-clock"></i>
                </div>
                <div className="stat-content">
                    <div className="stat-label">Waiting</div>
                    <div className="stat-value">{isNaN(animatedWaiting) ? 0 : animatedWaiting}</div>
                </div>
            </div>
        </div>
    );
};

export default StatsCards;
