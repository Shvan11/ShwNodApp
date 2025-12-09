import React, { useCallback, useMemo } from 'react';

/**
 * TeethSelector - Combined dental chart for teeth selection
 *
 * Features:
 * - Graphical SVG chart for permanent teeth (Palmer notation 1-8)
 * - Letter-based grid for deciduous teeth (A-E per quadrant)
 * - Multi-select support with visual selection states
 * - Toggle filters for permanent/deciduous visibility
 */

const TeethSelector = React.memo(({
    teethOptions = [],
    selectedTeethIds = [],
    onSelectionChange,
    showPermanent = true,
    showDeciduous = true,
    onFilterChange
}) => {
    // Memoize teeth groupings by quadrant
    const teethByQuadrant = useMemo(() => {
        const sortTeeth = (teeth, quadrant) => {
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

        const grouped = { permanent: {}, deciduous: {} };
        const quadrants = ['UR', 'UL', 'LR', 'LL'];

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
    const handleToothClick = useCallback((toothId) => {
        const newSelection = selectedSet.has(toothId)
            ? selectedTeethIds.filter(id => id !== toothId)
            : [...selectedTeethIds, toothId];
        onSelectionChange(newSelection);
    }, [selectedTeethIds, selectedSet, onSelectionChange]);

    // Handle filter changes
    const handleFilterChange = useCallback((type, value) => {
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
    const renderPermanentTooth = (tooth, isLower) => {
        const isSelected = selectedSet.has(tooth.ID);
        const toothNumber = tooth.ToothCode.replace(tooth.Quadrant, '');

        return (
            <div
                key={tooth.ID}
                className={`teeth-selector-tooth ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToothClick(tooth.ID)}
                title={tooth.ToothName}
            >
                {isLower && <span className="teeth-selector-number">{toothNumber}</span>}
                <img
                    src={`/images/teeth/chart/${tooth.ToothCode}.svg`}
                    alt={tooth.ToothCode}
                    loading="lazy"
                />
                {!isLower && <span className="teeth-selector-number">{toothNumber}</span>}
            </div>
        );
    };

    // Render deciduous tooth button (letter-based)
    const renderDeciduousTooth = (tooth) => {
        const isSelected = selectedSet.has(tooth.ID);
        const toothLetter = tooth.ToothCode.replace(tooth.Quadrant, '');

        return (
            <button
                key={tooth.ID}
                type="button"
                className={`teeth-selector-deciduous-btn ${isSelected ? 'selected' : ''}`}
                onClick={() => handleToothClick(tooth.ID)}
                title={tooth.ToothName}
            >
                {toothLetter}
            </button>
        );
    };

    // Render a permanent teeth arch (graphical)
    const renderPermanentArch = (label, isLower) => {
        const rightPrefix = isLower ? 'LR' : 'UR';
        const leftPrefix = isLower ? 'LL' : 'UL';

        const rightTeeth = teethByQuadrant.permanent[rightPrefix];
        const leftTeeth = teethByQuadrant.permanent[leftPrefix];

        if (rightTeeth.length === 0 && leftTeeth.length === 0) return null;

        return (
            <div className="teeth-selector-arch">
                {!isLower && <div className="teeth-selector-arch-label">{label}</div>}
                <div className="teeth-selector-arch-teeth">
                    {rightTeeth.map(tooth => renderPermanentTooth(tooth, isLower))}
                    <span className="teeth-selector-midline">|</span>
                    {leftTeeth.map(tooth => renderPermanentTooth(tooth, isLower))}
                </div>
                {isLower && <div className="teeth-selector-arch-label">{label}</div>}
            </div>
        );
    };

    // Render deciduous teeth arch (letter buttons)
    const renderDeciduousArch = (label, isLower) => {
        const rightPrefix = isLower ? 'LR' : 'UR';
        const leftPrefix = isLower ? 'LL' : 'UL';

        const rightTeeth = teethByQuadrant.deciduous[rightPrefix];
        const leftTeeth = teethByQuadrant.deciduous[leftPrefix];

        if (rightTeeth.length === 0 && leftTeeth.length === 0) return null;

        return (
            <div className="teeth-selector-arch deciduous">
                {!isLower && <div className="teeth-selector-arch-label">{label}</div>}
                <div className="teeth-selector-deciduous-row">
                    {rightTeeth.map(tooth => renderDeciduousTooth(tooth))}
                    <span className="teeth-selector-midline">|</span>
                    {leftTeeth.map(tooth => renderDeciduousTooth(tooth))}
                </div>
                {isLower && <div className="teeth-selector-arch-label">{label}</div>}
            </div>
        );
    };

    return (
        <div className="teeth-selector-container">
            {/* Filter toggles */}
            {(hasPermanentTeeth || hasDeciduousTeeth) && onFilterChange && (
                <div className="teeth-selector-filters">
                    {hasPermanentTeeth && (
                        <label className="teeth-selector-filter">
                            <input
                                type="checkbox"
                                checked={showPermanent}
                                onChange={(e) => handleFilterChange('permanent', e.target.checked)}
                            />
                            <span>Permanent</span>
                        </label>
                    )}
                    {hasDeciduousTeeth && (
                        <label className="teeth-selector-filter">
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
                <div className="teeth-selector-permanent">
                    {renderPermanentArch('Upper', false)}
                    {renderPermanentArch('Lower', true)}
                </div>
            )}

            {/* Deciduous Teeth - Letter Grid */}
            {showDeciduous && hasDeciduousTeeth && (
                <div className="teeth-selector-deciduous">
                    <div className="teeth-selector-deciduous-label">Deciduous Teeth</div>
                    {renderDeciduousArch('Upper (Primary)', false)}
                    {renderDeciduousArch('Lower (Primary)', true)}
                </div>
            )}

            {/* Selected display */}
            {selectedTeethIds.length > 0 && (
                <div className="teeth-selector-selected">
                    <strong>Selected:</strong> {selectedDisplay}
                    <button
                        type="button"
                        className="teeth-selector-clear"
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
