import React, { useCallback, useMemo } from 'react';
import cn from 'classnames';
import styles from './TeethSelector.module.css';

/**
 * TeethSelector - Combined dental chart for teeth selection
 *
 * Features:
 * - Graphical SVG chart for permanent teeth (Palmer notation 1-8)
 * - Letter-based grid for deciduous teeth (A-E per quadrant)
 * - Multi-select support with visual selection states
 * - Toggle filters for permanent/deciduous visibility
 */

interface ToothOption {
    ID: number;
    ToothCode: string;
    ToothName: string;
    ToothNumber?: string;
    Quadrant: 'UR' | 'UL' | 'LR' | 'LL';
    IsPermanent: boolean;
}

interface TeethSelectorProps {
    teethOptions?: ToothOption[];
    selectedTeethIds?: number[];
    onSelectionChange: (selectedIds: number[]) => void;
    showPermanent?: boolean;
    showDeciduous?: boolean;
    onFilterChange?: (type: 'permanent' | 'deciduous', value: boolean) => void;
}

type QuadrantKey = 'UR' | 'UL' | 'LR' | 'LL';

interface TeethByQuadrant {
    permanent: Record<QuadrantKey, ToothOption[]>;
    deciduous: Record<QuadrantKey, ToothOption[]>;
}

const TeethSelector = React.memo(({
    teethOptions = [],
    selectedTeethIds = [],
    onSelectionChange,
    showPermanent = true,
    showDeciduous = true,
    onFilterChange
}: TeethSelectorProps) => {
    // Memoize teeth groupings by quadrant
    const teethByQuadrant = useMemo((): TeethByQuadrant => {
        const sortTeeth = (teeth: ToothOption[], quadrant: QuadrantKey): ToothOption[] => {
            return [...teeth].sort((a, b) => {
                // Sort by ToothNumber for consistent Palmer notation display
                // Right quadrants: 8→1 (outer to midline, descending)
                // Left quadrants: 1→8 (midline to outer, ascending)
                const numA = a.ToothNumber || a.ToothCode.replace(a.Quadrant, '');
                const numB = b.ToothNumber || b.ToothCode.replace(b.Quadrant, '');

                if (quadrant === 'UR' || quadrant === 'LR') {
                    // Right side: descending (8, 7, 6... 1)
                    return numB.localeCompare(numA, undefined, { numeric: true });
                }
                // Left side: ascending (1, 2, 3... 8) or (A, B, C... E)
                return numA.localeCompare(numB, undefined, { numeric: true });
            });
        };

        const grouped: TeethByQuadrant = {
            permanent: { UR: [], UL: [], LR: [], LL: [] },
            deciduous: { UR: [], UL: [], LR: [], LL: [] }
        };
        const quadrants: QuadrantKey[] = ['UR', 'UL', 'LR', 'LL'];

        quadrants.forEach(q => {
            const permanentTeeth = teethOptions.filter(t => t.Quadrant === q && t.IsPermanent);
            const deciduousTeeth = teethOptions.filter(t => t.Quadrant === q && !t.IsPermanent);
            grouped.permanent[q] = sortTeeth(permanentTeeth, q);
            grouped.deciduous[q] = sortTeeth(deciduousTeeth, q);
        });

        return grouped;
    }, [teethOptions]);

    // Memoize selected IDs as Set for O(1) lookup
    const selectedSet = useMemo(() => new Set(selectedTeethIds), [selectedTeethIds]);

    // Handle tooth click - toggle selection
    const handleToothClick = useCallback((toothId: number) => {
        const newSelection = selectedSet.has(toothId)
            ? selectedTeethIds.filter(id => id !== toothId)
            : [...selectedTeethIds, toothId];
        onSelectionChange(newSelection);
    }, [selectedTeethIds, selectedSet, onSelectionChange]);

    // Handle filter changes
    const handleFilterChange = useCallback((type: 'permanent' | 'deciduous', value: boolean) => {
        onFilterChange?.(type, value);
    }, [onFilterChange]);

    // Handle clear all
    const handleClearAll = useCallback(() => {
        onSelectionChange([]);
    }, [onSelectionChange]);

    // Memoize computed values
    const hasPermanentTeeth = useMemo(() => teethOptions.some(t => t.IsPermanent), [teethOptions]);
    const hasDeciduousTeeth = useMemo(() => teethOptions.some(t => !t.IsPermanent), [teethOptions]);

    // Get selected teeth display text
    const selectedDisplay = useMemo(() => {
        if (selectedTeethIds.length === 0) return '';
        const teethMap = new Map(teethOptions.map(t => [t.ID, t.ToothCode]));
        return selectedTeethIds.map(id => teethMap.get(id)).filter(Boolean).join(', ');
    }, [selectedTeethIds, teethOptions]);

    // Render a single graphical tooth for permanent teeth
    const renderPermanentTooth = (tooth: ToothOption, isLower: boolean) => {
        const isSelected = selectedSet.has(tooth.ID);
        const toothNumber = tooth.ToothCode.replace(tooth.Quadrant, '');

        return (
            <div
                key={tooth.ID}
                className={cn(styles.tooth, isSelected && styles.toothSelected)}
                onClick={() => handleToothClick(tooth.ID)}
                title={tooth.ToothName}
            >
                {isLower && <span className={styles.toothNumber}>{toothNumber}</span>}
                <img
                    src={`/images/teeth/chart/${tooth.ToothCode}.svg`}
                    alt={tooth.ToothCode}
                    loading="lazy"
                />
                {!isLower && <span className={styles.toothNumber}>{toothNumber}</span>}
            </div>
        );
    };

    // Render deciduous tooth button (letter-based)
    const renderDeciduousTooth = (tooth: ToothOption) => {
        const isSelected = selectedSet.has(tooth.ID);
        const toothLetter = tooth.ToothCode.replace(tooth.Quadrant, '');

        return (
            <button
                key={tooth.ID}
                type="button"
                className={cn(styles.deciduousBtn, isSelected && styles.deciduousBtnSelected)}
                onClick={() => handleToothClick(tooth.ID)}
                title={tooth.ToothName}
            >
                {toothLetter}
            </button>
        );
    };

    // Render a permanent teeth arch (graphical)
    const renderPermanentArch = (label: string, isLower: boolean) => {
        const rightPrefix: QuadrantKey = isLower ? 'LR' : 'UR';
        const leftPrefix: QuadrantKey = isLower ? 'LL' : 'UL';

        const rightTeeth = teethByQuadrant.permanent[rightPrefix];
        const leftTeeth = teethByQuadrant.permanent[leftPrefix];

        if (rightTeeth.length === 0 && leftTeeth.length === 0) return null;

        return (
            <div className={styles.arch}>
                {!isLower && <div className={styles.archLabel}>{label}</div>}
                <div className={styles.archTeeth}>
                    {rightTeeth.map(tooth => renderPermanentTooth(tooth, isLower))}
                    <span className={styles.midline}>|</span>
                    {leftTeeth.map(tooth => renderPermanentTooth(tooth, isLower))}
                </div>
                {isLower && <div className={styles.archLabel}>{label}</div>}
            </div>
        );
    };

    // Render deciduous teeth arch (letter buttons)
    const renderDeciduousArch = (label: string, isLower: boolean) => {
        const rightPrefix: QuadrantKey = isLower ? 'LR' : 'UR';
        const leftPrefix: QuadrantKey = isLower ? 'LL' : 'UL';

        const rightTeeth = teethByQuadrant.deciduous[rightPrefix];
        const leftTeeth = teethByQuadrant.deciduous[leftPrefix];

        if (rightTeeth.length === 0 && leftTeeth.length === 0) return null;

        return (
            <div className={cn(styles.arch, styles.archDeciduous)}>
                {!isLower && <div className={styles.archLabel}>{label}</div>}
                <div className={styles.deciduousRow}>
                    {rightTeeth.map(tooth => renderDeciduousTooth(tooth))}
                    <span className={styles.midline}>|</span>
                    {leftTeeth.map(tooth => renderDeciduousTooth(tooth))}
                </div>
                {isLower && <div className={styles.archLabel}>{label}</div>}
            </div>
        );
    };

    return (
        <div className={styles.container}>
            {/* Filter toggles */}
            {(hasPermanentTeeth || hasDeciduousTeeth) && onFilterChange && (
                <div className={styles.filters}>
                    {hasPermanentTeeth && (
                        <label className={styles.filter}>
                            <input
                                type="checkbox"
                                checked={showPermanent}
                                onChange={(e) => handleFilterChange('permanent', e.target.checked)}
                            />
                            <span>Permanent</span>
                        </label>
                    )}
                    {hasDeciduousTeeth && (
                        <label className={styles.filter}>
                            <input
                                type="checkbox"
                                checked={showDeciduous}
                                onChange={(e) => handleFilterChange('deciduous', e.target.checked)}
                            />
                            <span>Deciduous</span>
                        </label>
                    )}
                </div>
            )}

            {/* Permanent Teeth - Graphical Chart */}
            {showPermanent && hasPermanentTeeth && (
                <div className={styles.permanent}>
                    {renderPermanentArch('Upper', false)}
                    {renderPermanentArch('Lower', true)}
                </div>
            )}

            {/* Deciduous Teeth - Letter Grid */}
            {showDeciduous && hasDeciduousTeeth && (
                <div className={styles.deciduous}>
                    <div className={styles.deciduousLabel}>Deciduous Teeth</div>
                    {renderDeciduousArch('Upper (Primary)', false)}
                    {renderDeciduousArch('Lower (Primary)', true)}
                </div>
            )}

            {/* Selected display */}
            {selectedTeethIds.length > 0 && (
                <div className={styles.selected}>
                    <strong>Selected:</strong> {selectedDisplay}
                    <button
                        type="button"
                        className={styles.clearBtn}
                        onClick={handleClearAll}
                    >
                        Clear All
                    </button>
                </div>
            )}
        </div>
    );
});

TeethSelector.displayName = 'TeethSelector';

export default TeethSelector;
