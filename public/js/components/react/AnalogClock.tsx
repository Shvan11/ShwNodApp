import { useEffect, useMemo, useState } from 'react';
import styles from './AnalogClock.module.css';

// Static SVG geometry — same every render, so compute once at module load.
const HOUR_MARKS = Array.from({ length: 12 }, (_, i) => {
    const rad = ((i / 12) * 360 - 90) * (Math.PI / 180);
    return {
        i,
        x1: 50 + Math.cos(rad) * 42,
        y1: 50 + Math.sin(rad) * 42,
        x2: 50 + Math.cos(rad) * 46,
        y2: 50 + Math.sin(rad) * 46,
    };
});

const MINUTE_MARKS = Array.from({ length: 60 }, (_, i) => i)
    .filter((i) => i % 5 !== 0)
    .map((i) => {
        const rad = ((i / 60) * 360 - 90) * (Math.PI / 180);
        return {
            i,
            x1: 50 + Math.cos(rad) * 44,
            y1: 50 + Math.sin(rad) * 44,
            x2: 50 + Math.cos(rad) * 46,
            y2: 50 + Math.sin(rad) * 46,
        };
    });

const NUMERALS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
    const rad = ((i / 12) * 360 - 90) * (Math.PI / 180);
    return {
        n,
        x: 50 + Math.cos(rad) * 35,
        y: 50 + Math.sin(rad) * 35,
    };
});

interface AnalogClockProps {
    size: number;
    showDate?: boolean;
    className?: string;
}

interface ClockTime {
    hour: number;
    minute: number;
    second: number;
    date: Date;
}

const computeNow = (): ClockTime => {
    const date = new Date();
    return {
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
        date,
    };
};

const AnalogClock = ({ size, showDate = true, className }: AnalogClockProps) => {
    const [now, setNow] = useState<ClockTime>(computeNow);

    useEffect(() => {
        // Tick once per second. Hands jump in 1s steps (no smooth sweep) —
        // intentional for the kiosk's all-day uptime: ~1 render/sec instead
        // of ~60. Pause when the tab is hidden; re-sync on visibility change.
        let intervalId: number | null = null;

        const start = () => {
            if (intervalId !== null) return;
            setNow(computeNow());
            intervalId = window.setInterval(() => setNow(computeNow()), 1000);
        };

        const stop = () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId);
                intervalId = null;
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                start();
            } else {
                stop();
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        if (document.visibilityState === 'visible') start();

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    // Hand angles (degrees from 12 o'clock). Second is integer 0–59 — hands
    // jump in 1s steps. No sub-second smoothing: the kiosk runs all day and
    // the trade is intentional.
    const secondAngle = (now.second / 60) * 360;
    const minuteAngle = ((now.minute + now.second / 60) / 60) * 360;
    const hourAngle = (((now.hour % 12) + now.minute / 60) / 12) * 360;

    // Date label only changes once per day; memo so it isn't re-formatted
    // on every per-second tick.
    const dateLabel = useMemo(() => {
        if (!showDate) return null;
        return now.date.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
    }, [showDate, now.date.getDate(), now.date.getMonth(), now.date.getFullYear()]);

    return (
        <svg
            className={className ? `${styles.clock} ${className}` : styles.clock}
            width={size}
            height={size}
            viewBox="0 0 100 100"
            role="img"
            aria-label="Analog clock"
        >
            <circle cx={50} cy={50} r={48} className={styles.face} />
            <circle cx={50} cy={50} r={47} className={styles.bezel} />

            {HOUR_MARKS.map((m) => (
                <line
                    key={`h-${m.i}`}
                    x1={m.x1}
                    y1={m.y1}
                    x2={m.x2}
                    y2={m.y2}
                    className={styles.hourMark}
                />
            ))}

            {MINUTE_MARKS.map((m) => (
                <line
                    key={`m-${m.i}`}
                    x1={m.x1}
                    y1={m.y1}
                    x2={m.x2}
                    y2={m.y2}
                    className={styles.minuteMark}
                />
            ))}

            {NUMERALS.map((nm) => (
                <text
                    key={`n-${nm.n}`}
                    x={nm.x}
                    y={nm.y}
                    className={styles.numeral}
                    fontSize="7"
                >
                    {nm.n}
                </text>
            ))}

            {dateLabel && (
                <text x={50} y={68} className={styles.dateLabel}>
                    {dateLabel}
                </text>
            )}

            <line
                x1={50}
                y1={50}
                x2={50}
                y2={22}
                className={styles.hourHand}
                transform={`rotate(${hourAngle} 50 50)`}
            />
            <line
                x1={50}
                y1={50}
                x2={50}
                y2={14}
                className={styles.minuteHand}
                transform={`rotate(${minuteAngle} 50 50)`}
            />
            <line
                x1={50}
                y1={56}
                x2={50}
                y2={10}
                className={styles.secondHand}
                transform={`rotate(${secondAngle} 50 50)`}
            />
            <circle cx={50} cy={50} r={2.4} className={styles.cap} />
            <circle cx={50} cy={50} r={0.9} className={styles.capInner} />
        </svg>
    );
};

export default AnalogClock;
