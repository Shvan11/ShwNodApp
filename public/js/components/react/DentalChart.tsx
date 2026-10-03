/**
 * DentalChart - Simple dental chart with Palmer notation
 * Click tooth or between-teeth area to insert text
 *
 * Keyboard: the chart is ONE tab stop (a roving tabindex) — it used to put all
 * 62 targets (32 teeth + 30 between-tooth slots) in the form's tab order.
 * ←/→ move along a row, ↑/↓ switch row at the matching position, Home/End jump
 * to a row's ends, Enter/Space inserts.
 *
 * Primary (deciduous) teeth: a "Primary teeth" switch adds an A–E row under the
 * upper arch and over the lower one (URE…URA | ULA…ULE, LRE…LRA | LLA…LLE), so a
 * mixed-dentition visit note can click a primary tooth — clicking inserts e.g.
 * "URC". Off by default, so the adult chart is unchanged (audit FE-F9-12, owner's
 * call 2026-10-03). Same letters as the work-item TeethSelector.
 */

import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import cn from 'classnames';
import styles from './DentalChart.module.css';

interface DentalChartProps {
    onToothClick: (notation: string) => void;
}

type ChartItem =
    | { kind: 'tooth'; prefix: string; number: number; notation: string }
    | { kind: 'primary'; notation: string; letter: string }
    | { kind: 'between'; notation: string; midline: boolean };

interface ChartRow {
    id: string;
    label: string;
    /** Number sits under the image on the upper arch, over it on the lower. */
    isLower: boolean;
    primary: boolean;
    items: ChartItem[];
}

/** One permanent arch, right-to-left as the patient faces you: R8 … R1 | L1 … L8, with a slot between each pair. */
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

const PRIMARY_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

/** One primary arch, same orientation: RE … RA | LA … LE (teeth only). */
function buildPrimaryArch(rightPrefix: string, leftPrefix: string): ChartItem[] {
    const tooth = (prefix: string, letter: string): ChartItem =>
        ({ kind: 'primary', letter, notation: `${prefix}${letter}` });
    return [
        ...[...PRIMARY_LETTERS].reverse().map((l) => tooth(rightPrefix, l)),
        ...PRIMARY_LETTERS.map((l) => tooth(leftPrefix, l)),
    ];
}

const UPPER: ChartRow = { id: 'upper', label: 'Upper Teeth', isLower: false, primary: false, items: buildArch('UR', 'UL') };
const UPPER_PRIMARY: ChartRow = { id: 'upper-primary', label: 'Upper Primary', isLower: false, primary: true, items: buildPrimaryArch('UR', 'UL') };
const LOWER_PRIMARY: ChartRow = { id: 'lower-primary', label: 'Lower Primary', isLower: true, primary: true, items: buildPrimaryArch('LR', 'LL') };
const LOWER: ChartRow = { id: 'lower', label: 'Lower Teeth', isLower: true, primary: false, items: buildArch('LR', 'LL') };

const PERMANENT_ROWS = [UPPER, LOWER];
const MIXED_ROWS = [UPPER, UPPER_PRIMARY, LOWER_PRIMARY, LOWER];

/** The item at the same relative position in a row of a different length. */
const matchIndex = (index: number, fromLength: number, toLength: number): number =>
    fromLength <= 1 ? 0 : Math.round((index * (toLength - 1)) / (fromLength - 1));

const DentalChart = ({ onToothClick }: DentalChartProps) => {
    const [showPrimary, setShowPrimary] = useState(false);
    const rows = showPrimary ? MIXED_ROWS : PERMANENT_ROWS;

    // The one element in the tab order: [row id, index]. Starts on UR8. A row
    // that the switch just hid falls back to the start.
    const [activeState, setActive] = useState<[string, number]>(['upper', 0]);
    const active: [string, number] = rows.some((r) => r.id === activeState[0]) ? activeState : ['upper', 0];
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const moveTo = (rowIndex: number, index: number) => {
        const row = rows[rowIndex];
        setActive([row.id, index]);
        itemRefs.current.get(`${row.id}:${index}`)?.focus();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>, rowIndex: number, index: number, notation: string) => {
        const length = rows[rowIndex].items.length;
        switch (e.key) {
            case 'Enter':
            case ' ':
                e.preventDefault();
                onToothClick(notation);
                return;
            case 'ArrowRight':
                e.preventDefault();
                moveTo(rowIndex, Math.min(index + 1, length - 1));
                return;
            case 'ArrowLeft':
                e.preventDefault();
                moveTo(rowIndex, Math.max(index - 1, 0));
                return;
            case 'ArrowUp':
            case 'ArrowDown': {
                e.preventDefault();
                const target = e.key === 'ArrowUp' ? Math.max(rowIndex - 1, 0) : Math.min(rowIndex + 1, rows.length - 1);
                moveTo(target, matchIndex(index, length, rows[target].items.length));
                return;
            }
            case 'Home':
                e.preventDefault();
                moveTo(rowIndex, 0);
                return;
            case 'End':
                e.preventDefault();
                moveTo(rowIndex, length - 1);
                return;
            default:
        }
    };

    const renderItem = (item: ChartItem, row: ChartRow, rowIndex: number, index: number) => {
        const key = `${row.id}:${index}`;
        const common = {
            ref: (el: HTMLDivElement | null) => {
                if (el) itemRefs.current.set(key, el);
                else itemRefs.current.delete(key);
            },
            role: 'button' as const,
            tabIndex: active[0] === row.id && active[1] === index ? 0 : -1,
            'aria-label': item.notation,
            onClick: () => {
                setActive([row.id, index]);
                onToothClick(item.notation);
            },
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleKeyDown(e, rowIndex, index, item.notation),
        };

        if (item.kind === 'between') {
            return (
                <div key={item.notation} className={cn(styles.between, item.midline && styles.midline)} {...common}>
                    <div className={styles.betweenIndicator} />
                </div>
            );
        }

        if (item.kind === 'primary') {
            return (
                <div key={item.notation} className={cn(styles.primaryTooth, index === 5 && styles.primaryMidline)} {...common}>
                    <span aria-hidden="true">{item.letter}</span>
                </div>
            );
        }

        return (
            <div key={item.notation} className={styles.tooth} {...common}>
                {row.isLower && <span className={styles.toothNumber} aria-hidden="true">{item.number}</span>}
                <img
                    src={`/images/teeth/chart/${item.prefix}${item.number}.svg`}
                    alt=""
                    onError={(e: SyntheticEvent<HTMLImageElement>) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
                {!row.isLower && <span className={styles.toothNumber} aria-hidden="true">{item.number}</span>}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <label className={styles.primarySwitch}>
                <input
                    type="checkbox"
                    checked={showPrimary}
                    onChange={(e) => setShowPrimary(e.target.checked)}
                />
                Primary teeth
            </label>
            {rows.map((row, rowIndex) => (
                <div key={row.id} className={cn(styles.arch, row.primary && styles.primaryArch)}>
                    <div className={styles.archLabel}>{row.label}</div>
                    <div className={styles.archTeeth} role="group" aria-label={row.label}>
                        {row.items.map((item, index) => renderItem(item, row, rowIndex, index))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default DentalChart;
