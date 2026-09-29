/**
 * DentalChart - Simple dental chart with Palmer notation
 * Click tooth or between-teeth area to insert text
 *
 * Keyboard: the chart is ONE tab stop (a roving tabindex) — it used to put all
 * 62 targets (32 teeth + 30 between-tooth slots) in the form's tab order.
 * ←/→ move along an arch, ↑/↓ switch arch at the same position, Home/End jump
 * to an arch's ends, Enter/Space inserts.
 */

import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import cn from 'classnames';
import styles from './DentalChart.module.css';

interface DentalChartProps {
    onToothClick: (notation: string) => void;
}

type ChartItem =
    | { kind: 'tooth'; prefix: string; number: number; notation: string }
    | { kind: 'between'; notation: string; midline: boolean };

/** One arch, right-to-left as the patient faces you: R8 … R1 | L1 … L8, with a slot between each pair. */
function buildArch(rightPrefix: string, leftPrefix: string): ChartItem[] {
    const items: ChartItem[] = [];
    const tooth = (prefix: string, number: number): ChartItem =>
        ({ kind: 'tooth', prefix, number, notation: `${prefix}${number}` });
    const between = (a: string, b: string, midline = false): ChartItem =>
        ({ kind: 'between', notation: `Between ${a} and ${b}`, midline });

    for (let i = 8; i >= 1; i--) {
        items.push(tooth(rightPrefix, i));
        if (i > 1) items.push(between(`${rightPrefix}${i - 1}`, `${rightPrefix}${i}`));
    }
    items.push(between(`${rightPrefix}1`, `${leftPrefix}1`, true));
    for (let i = 1; i <= 8; i++) {
        items.push(tooth(leftPrefix, i));
        if (i < 8) items.push(between(`${leftPrefix}${i}`, `${leftPrefix}${i + 1}`));
    }
    return items;
}

const ARCHES = [
    { label: 'Upper Teeth', isLower: false, items: buildArch('UR', 'UL') },
    { label: 'Lower Teeth', isLower: true, items: buildArch('LR', 'LL') },
];
const ARCH_LENGTH = ARCHES[0].items.length; // 31: 16 teeth + 15 slots

const DentalChart = ({ onToothClick }: DentalChartProps) => {
    // The one element in the tab order: [arch, index]. Starts on UR8.
    const [active, setActive] = useState<[number, number]>([0, 0]);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const moveTo = (arch: number, index: number) => {
        setActive([arch, index]);
        itemRefs.current.get(`${arch}:${index}`)?.focus();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>, arch: number, index: number, notation: string) => {
        switch (e.key) {
            case 'Enter':
            case ' ':
                e.preventDefault();
                onToothClick(notation);
                return;
            case 'ArrowRight':
                e.preventDefault();
                moveTo(arch, Math.min(index + 1, ARCH_LENGTH - 1));
                return;
            case 'ArrowLeft':
                e.preventDefault();
                moveTo(arch, Math.max(index - 1, 0));
                return;
            case 'ArrowUp':
            case 'ArrowDown':
                e.preventDefault();
                moveTo(e.key === 'ArrowUp' ? 0 : 1, index);
                return;
            case 'Home':
                e.preventDefault();
                moveTo(arch, 0);
                return;
            case 'End':
                e.preventDefault();
                moveTo(arch, ARCH_LENGTH - 1);
                return;
            default:
        }
    };

    const renderItem = (item: ChartItem, arch: number, index: number, isLower: boolean) => {
        const common = {
            ref: (el: HTMLDivElement | null) => {
                if (el) itemRefs.current.set(`${arch}:${index}`, el);
                else itemRefs.current.delete(`${arch}:${index}`);
            },
            role: 'button' as const,
            tabIndex: active[0] === arch && active[1] === index ? 0 : -1,
            'aria-label': item.notation,
            onClick: () => {
                setActive([arch, index]);
                onToothClick(item.notation);
            },
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleKeyDown(e, arch, index, item.notation),
        };

        if (item.kind === 'between') {
            return (
                <div key={item.notation} className={cn(styles.between, item.midline && styles.midline)} {...common}>
                    <div className={styles.betweenIndicator} />
                </div>
            );
        }

        return (
            <div key={item.notation} className={styles.tooth} {...common}>
                {isLower && <span className={styles.toothNumber} aria-hidden="true">{item.number}</span>}
                <img
                    src={`/images/teeth/chart/${item.prefix}${item.number}.svg`}
                    alt=""
                    onError={(e: SyntheticEvent<HTMLImageElement>) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
                {!isLower && <span className={styles.toothNumber} aria-hidden="true">{item.number}</span>}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            {ARCHES.map((arch, archIndex) => (
                <div key={arch.label} className={styles.arch}>
                    <div className={styles.archLabel}>{arch.label}</div>
                    <div className={styles.archTeeth} role="group" aria-label={arch.label}>
                        {arch.items.map((item, index) => renderItem(item, archIndex, index, arch.isLower))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default DentalChart;
