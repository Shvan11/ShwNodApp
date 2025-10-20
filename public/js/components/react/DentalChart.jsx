/**
 * DentalChart - Interactive dental chart component using Palmer notation
 *
 * Features:
 * - Palmer notation (UR, UL, LR, LL)
 * - Different tooth image placeholders for each tooth type
 * - Click to append tooth number to text field
 * - Reusable across the application
 *
 * Props:
 * - onToothClick: (palmerNotation) => void - Callback when tooth is clicked
 * - selectedTeeth: string[] - Array of selected tooth notations (optional, for highlighting)
 */

import React, { useState } from 'react';

const DentalChart = ({ onToothClick, selectedTeeth = [] }) => {
    // Palmer notation prefixes
    const palmerPrefixes = {
        ur: 'UR', // Upper Right
        ul: 'UL', // Upper Left
        lr: 'LR', // Lower Right
        ll: 'LL'  // Lower Left
    };

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

    // Create tooth element
    const Tooth = ({ quadrant, number, prefix }) => {
        const palmer = `${prefix}${number}`;
        const isSelected = selectedTeeth.includes(palmer);

        return (
            <div
                onClick={() => onToothClick(palmer)}
                style={{
                    width: '40px',
                    height: '50px',
                    border: `2px solid ${isSelected ? '#667eea' : '#cbd5e0'}`,
                    borderRadius: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: isSelected
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : 'white',
                    position: 'relative'
                }}
                onMouseEnter={(e) => {
                    if (!isSelected) {
                        e.currentTarget.style.borderColor = '#4299e1';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(66, 153, 225, 0.3)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (!isSelected) {
                        e.currentTarget.style.borderColor = '#cbd5e0';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }
                }}
            >
                <div style={{ marginBottom: '0.15rem' }}>
                    <img
                        src={getToothImage(quadrant, number)}
                        alt={`Tooth ${number}`}
                        style={{
                            width: '28px',
                            height: '32px',
                            objectFit: 'contain',
                            filter: isSelected ? 'brightness(0) invert(1)' : 'grayscale(0%)',
                            transition: 'all 0.3s'
                        }}
                        onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = '<div style="font-size: 1.5rem;">🦷</div>';
                        }}
                    />
                </div>
                <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '600',
                    color: isSelected ? 'white' : '#4a5568'
                }}>
                    {number}
                </div>
            </div>
        );
    };

    // Helper to render a full arch (left + right quadrants on one line)
    const renderArch = (leftQuadrant, rightQuadrant, label) => {
        const rightTeeth = [];
        const leftTeeth = [];

        // Right quadrant (8 to 1, reversed)
        for (let i = 8; i >= 1; i--) {
            rightTeeth.push(
                <Tooth
                    key={`${rightQuadrant.id}-${i}`}
                    quadrant={rightQuadrant.id}
                    number={i}
                    prefix={rightQuadrant.prefix}
                />
            );
        }

        // Left quadrant (1 to 8)
        for (let i = 1; i <= 8; i++) {
            leftTeeth.push(
                <Tooth
                    key={`${leftQuadrant.id}-${i}`}
                    quadrant={leftQuadrant.id}
                    number={i}
                    prefix={leftQuadrant.prefix}
                />
            );
        }

        return (
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    marginBottom: '0.75rem',
                    fontSize: '1rem'
                }}>
                    {label}
                </div>
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '0.3rem',
                    flexWrap: 'nowrap'
                }}>
                    {rightTeeth}
                    <div style={{
                        width: '3px',
                        height: '50px',
                        backgroundColor: '#e53e3e',
                        margin: '0 0.4rem',
                        borderRadius: '1px'
                    }}></div>
                    {leftTeeth}
                </div>
            </div>
        );
    };

    return (
        <div style={{
            backgroundColor: '#f7fafc',
            borderRadius: '12px',
            padding: '2rem',
            marginBottom: '1rem'
        }}>
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

            {/* Legend */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem',
                color: '#6b7280',
                marginTop: '0.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid #e2e8f0'
            }}>
                <i className="fas fa-hand-pointer" style={{ color: '#4299e1' }}></i>
                <span>Click on teeth to select them</span>
            </div>
        </div>
    );
};

export default DentalChart;
