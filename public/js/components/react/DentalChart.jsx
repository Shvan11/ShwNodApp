/**
 * DentalChart - Interactive dental chart component using Palmer notation
 *
 * Features:
 * - Palmer notation (UR, UL, LR, LL)
 * - Different tooth image placeholders for each tooth type
 * - Click to append tooth number to text field
 * - Reusable across the application
 * - Optimized with React.memo to prevent unnecessary re-renders
 *
 * Props:
 * - onToothClick: (palmerNotation) => void - Callback when tooth is clicked
 * - selectedTeeth: string[] - Array of selected tooth notations (optional, for highlighting)
 */

import React from 'react';

// Memoized Tooth component to prevent unnecessary re-renders
const Tooth = React.memo(({ quadrant, number, prefix, isSelected, onToothClick }) => {
    const palmer = `${prefix}${number}`;

    // Get tooth image path based on quadrant and tooth number
    const getToothImage = (quadrant, number) => {
        const isUpper = quadrant === 'ur' || quadrant === 'ul';

        // Central incisors
        if (number === 1) {
            return isUpper
                ? '/images/teeth/upper-central.png'
                : '/images/teeth/lower-central.png';
        }
        // Lateral incisors
        else if (number === 2) {
            return isUpper
                ? '/images/teeth/upper-lateral.png'
                : '/images/teeth/lower-lateral.png';
        }
        // Canines
        else if (number === 3) {
            return '/images/teeth/canine.png';
        }
        // Premolars
        else if (number >= 4 && number <= 5) {
            return '/images/teeth/premolar.png';
        }
        // Molars
        else {
            return isUpper
                ? '/images/teeth/upper-molar.png'
                : '/images/teeth/lower-molar.png';
        }
    };

    return (
        <div
            onClick={() => onToothClick(palmer)}
            className={`dental-tooth ${isSelected ? 'selected' : ''}`}
        >
            <div className="dental-tooth-image">
                <img
                    src={getToothImage(quadrant, number)}
                    alt={`Tooth ${number}`}
                    onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<div class="tooth-emoji">🦷</div>';
                    }}
                />
            </div>
            <div className="dental-tooth-number">
                {number}
            </div>
        </div>
    );
});

Tooth.displayName = 'Tooth';

const DentalChart = React.memo(({ onToothClick, selectedTeeth = [] }) => {
    // Palmer notation prefixes
    const palmerPrefixes = {
        ur: 'UR', // Upper Right
        ul: 'UL', // Upper Left
        lr: 'LR', // Lower Right
        ll: 'LL'  // Lower Left
    };

    // Helper to render a full arch (left + right quadrants on one line)
    const renderArch = (leftQuadrant, rightQuadrant, label) => {
        const rightTeeth = [];
        const leftTeeth = [];

        // Right quadrant (8 to 1, reversed)
        for (let i = 8; i >= 1; i--) {
            const palmer = `${rightQuadrant.prefix}${i}`;
            rightTeeth.push(
                <Tooth
                    key={`${rightQuadrant.id}-${i}`}
                    quadrant={rightQuadrant.id}
                    number={i}
                    prefix={rightQuadrant.prefix}
                    isSelected={selectedTeeth.includes(palmer)}
                    onToothClick={onToothClick}
                />
            );
        }

        // Left quadrant (1 to 8)
        for (let i = 1; i <= 8; i++) {
            const palmer = `${leftQuadrant.prefix}${i}`;
            leftTeeth.push(
                <Tooth
                    key={`${leftQuadrant.id}-${i}`}
                    quadrant={leftQuadrant.id}
                    number={i}
                    prefix={leftQuadrant.prefix}
                    isSelected={selectedTeeth.includes(palmer)}
                    onToothClick={onToothClick}
                />
            );
        }

        return (
            <div className="dental-arch">
                <div className="dental-arch-label">
                    {label}
                </div>
                <div className="dental-arch-teeth">
                    {rightTeeth}
                    <div className="dental-midline"></div>
                    {leftTeeth}
                </div>
            </div>
        );
    };

    return (
        <div className="dental-chart-container">
            {/* Upper Arch (UR + UL) */}
            {renderArch(
                { id: 'ul', prefix: palmerPrefixes.ul },
                { id: 'ur', prefix: palmerPrefixes.ur },
                'Upper Teeth'
            )}

            {/* Lower Arch (LR + LL) */}
            {renderArch(
                { id: 'll', prefix: palmerPrefixes.ll },
                { id: 'lr', prefix: palmerPrefixes.lr },
                'Lower Teeth'
            )}
        </div>
    );
});

DentalChart.displayName = 'DentalChart';

export default DentalChart;
