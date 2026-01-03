/**
 * DentalChart - Simple dental chart with Palmer notation
 * Click tooth or between-teeth area to insert text
 */

import type { SyntheticEvent, ReactElement } from 'react';
import cn from 'classnames';
import styles from './DentalChart.module.css';

interface DentalChartProps {
    onToothClick: (notation: string) => void;
}

const DentalChart = ({ onToothClick }: DentalChartProps) => {
    const renderTooth = (prefix: string, number: number, isLower: boolean) => (
        <div
            key={`${prefix}${number}`}
            className={styles.tooth}
            onClick={() => onToothClick(`${prefix}${number}`)}
        >
            {isLower && <span className={styles.toothNumber}>{number}</span>}
            <img
                src={`/images/teeth/chart/${prefix.toUpperCase()}${number}.svg`}
                alt={`${prefix}${number}`}
                onError={(e: SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = 'none';
                }}
            />
            {!isLower && <span className={styles.toothNumber}>{number}</span>}
        </div>
    );

    const renderBetween = (tooth1: string, tooth2: string, isMidline?: boolean) => (
        <div
            key={`between-${tooth1}-${tooth2}`}
            className={cn(styles.between, isMidline && styles.midline)}
            onClick={() => onToothClick(`Between ${tooth1} and ${tooth2}`)}
        >
            <div className={styles.betweenIndicator} />
        </div>
    );

    const renderArch = (rightPrefix: string, leftPrefix: string, label: string, isLower: boolean) => {
        const elements: ReactElement[] = [];

        for (let i = 8; i >= 1; i--) {
            elements.push(renderTooth(rightPrefix, i, isLower));
            if (i > 1) elements.push(renderBetween(`${rightPrefix}${i - 1}`, `${rightPrefix}${i}`));
        }

        elements.push(renderBetween(`${rightPrefix}1`, `${leftPrefix}1`, true));

        for (let i = 1; i <= 8; i++) {
            elements.push(renderTooth(leftPrefix, i, isLower));
            if (i < 8) elements.push(renderBetween(`${leftPrefix}${i}`, `${leftPrefix}${i + 1}`));
        }

        return (
            <div className={styles.arch}>
                <div className={styles.archLabel}>{label}</div>
                <div className={styles.archTeeth}>{elements}</div>
            </div>
        );
    };

    return (
        <div className={styles.container}>
            {renderArch('UR', 'UL', 'Upper Teeth', false)}
            {renderArch('LR', 'LL', 'Lower Teeth', true)}
        </div>
    );
};

export default DentalChart;
