/**
 * LabelPreviewModal - Modern modal for previewing and editing aligner labels before printing
 *
 * Features:
 * - Displays all label information in editable fields
 * - Editable doctor name
 * - Toggle to include/exclude logo
 * - Fully editable individual labels (add, edit, remove)
 * - Default: combines U and L of same number on one label (they fit in one bag)
 * - Visual preview of label layout
 * - Starting position selector with visual grid
 *
 * @module LabelPreviewModal
 */
import React, { useState, useEffect, useMemo } from 'react';

const LABELS_PER_SHEET = 12;

/**
 * Build default label queue from upper/lower ranges
 * Default behavior: combine U and L of same sequence number on one label
 */
function buildDefaultLabels(upperStart, upperEnd, lowerStart, lowerEnd) {
    const labelMap = new Map();

    const hasUpper = upperStart != null && upperEnd != null && upperStart > 0;
    const hasLower = lowerStart != null && lowerEnd != null && lowerStart > 0;

    // Add upper aligners
    if (hasUpper) {
        for (let i = upperStart; i <= upperEnd; i++) {
            labelMap.set(i, 'U');
        }
    }

    // Add lower aligners (combine with upper if same sequence)
    if (hasLower) {
        for (let i = lowerStart; i <= lowerEnd; i++) {
            if (labelMap.has(i)) {
                labelMap.set(i, 'UL'); // Both upper and lower on same label
            } else {
                labelMap.set(i, 'L');
            }
        }
    }

    // Convert to array of label objects
    const labels = [];
    const sortedKeys = Array.from(labelMap.keys()).sort((a, b) => a - b);

    for (const seq of sortedKeys) {
        const type = labelMap.get(seq);
        let text;

        switch (type) {
            case 'U':
                text = `U${seq}`;
                break;
            case 'L':
                text = `L${seq}`;
                break;
            case 'UL':
                text = `U${seq}/L${seq}`;
                break;
        }

        labels.push({ id: `${type}-${seq}`, text, type });
    }

    return labels;
}

/**
 * Calculate total pages needed
 */
function calculatePages(totalLabels, startingPosition) {
    if (totalLabels === 0) return 0;
    const availableFirstPage = LABELS_PER_SHEET - startingPosition + 1;
    if (totalLabels <= availableFirstPage) {
        return 1;
    }
    const remaining = totalLabels - availableFirstPage;
    return 1 + Math.ceil(remaining / LABELS_PER_SHEET);
}

/**
 * Calculate next starting position after printing
 */
function calculateNextPosition(totalLabels, startingPosition) {
    if (totalLabels === 0) return startingPosition;
    const finalAbsolutePosition = startingPosition + totalLabels - 1;
    return (finalAbsolutePosition % LABELS_PER_SHEET) + 1;
}

const LabelPreviewModal = ({
    isOpen,
    onClose,
    onGenerate,
    batch,
    set,
    patient,
    doctorName: initialDoctorName,
    isGenerating = false
}) => {
    // Available Arabic fonts
    const ARABIC_FONTS = [
        { id: 'cairo', name: 'Cairo', description: 'Modern, clean' },
        { id: 'noto', name: 'Noto Sans Arabic', description: 'Standard' },
    ];

    // Editable fields
    const [patientName, setPatientName] = useState('');
    const [doctorName, setDoctorName] = useState('');
    const [includeLogo, setIncludeLogo] = useState(true);
    const [startingPosition, setStartingPosition] = useState(1);
    const [arabicFont, setArabicFont] = useState('cairo');

    // Editable labels array
    const [labels, setLabels] = useState([]);

    // New label input
    const [newLabelText, setNewLabelText] = useState('');

    // Edit mode for individual labels
    const [editingLabelId, setEditingLabelId] = useState(null);
    const [editLabelText, setEditLabelText] = useState('');

    // Initialize values when modal opens
    useEffect(() => {
        if (isOpen && batch && patient) {
            // Set patient name
            const name = patient.PatientName ||
                        (patient.FirstName && patient.LastName
                            ? `${patient.FirstName} ${patient.LastName}`
                            : 'Unknown Patient');
            setPatientName(name);

            // Set doctor name with "Dr. " prefix if not already present
            const drName = initialDoctorName || '';
            setDoctorName(drName.startsWith('Dr.') || drName.startsWith('Dr ') ? drName : `Dr. ${drName}`);

            // Reset logo toggle
            setIncludeLogo(true);

            // Build default labels from batch ranges
            const defaultLabels = buildDefaultLabels(
                batch.UpperAlignerStartSequence,
                batch.UpperAlignerEndSequence,
                batch.LowerAlignerStartSequence,
                batch.LowerAlignerEndSequence
            );
            setLabels(defaultLabels);

            // Reset starting position
            setStartingPosition(1);

            // Reset edit states
            setNewLabelText('');
            setEditingLabelId(null);
            setEditLabelText('');

            // Reset font to default
            setArabicFont('cairo');
        }
    }, [isOpen, batch, patient, initialDoctorName]);

    const totalLabels = labels.length;
    const totalPages = calculatePages(totalLabels, startingPosition);
    const nextPosition = calculateNextPosition(totalLabels, startingPosition);

    // Validation
    const isValid = patientName.trim() !== '' &&
                    doctorName.trim() !== '' &&
                    labels.length > 0 &&
                    startingPosition >= 1 &&
                    startingPosition <= 12;

    // Label management functions
    const addLabel = () => {
        const text = newLabelText.trim().toUpperCase();
        if (!text) return;

        // Generate unique id
        const id = `custom-${Date.now()}`;

        // Determine type based on text
        let type = 'custom';
        if (text.includes('/')) {
            type = 'UL';
        } else if (text.startsWith('U')) {
            type = 'U';
        } else if (text.startsWith('L')) {
            type = 'L';
        }

        setLabels(prev => [...prev, { id, text, type }]);
        setNewLabelText('');
    };

    const removeLabel = (id) => {
        setLabels(prev => prev.filter(l => l.id !== id));
    };

    const startEditLabel = (label) => {
        setEditingLabelId(label.id);
        setEditLabelText(label.text);
    };

    const saveEditLabel = () => {
        if (!editLabelText.trim()) {
            // If empty, remove the label
            removeLabel(editingLabelId);
        } else {
            const text = editLabelText.trim().toUpperCase();
            let type = 'custom';
            if (text.includes('/')) {
                type = 'UL';
            } else if (text.startsWith('U')) {
                type = 'U';
            } else if (text.startsWith('L')) {
                type = 'L';
            }

            setLabels(prev => prev.map(l =>
                l.id === editingLabelId ? { ...l, text, type } : l
            ));
        }
        setEditingLabelId(null);
        setEditLabelText('');
    };

    const cancelEditLabel = () => {
        setEditingLabelId(null);
        setEditLabelText('');
    };

    const clearAllLabels = () => {
        setLabels([]);
    };

    const resetToDefault = () => {
        if (batch) {
            const defaultLabels = buildDefaultLabels(
                batch.UpperAlignerStartSequence,
                batch.UpperAlignerEndSequence,
                batch.LowerAlignerStartSequence,
                batch.LowerAlignerEndSequence
            );
            setLabels(defaultLabels);
        }
    };

    // Handle generate
    const handleGenerate = () => {
        if (!isValid) return;

        onGenerate({
            patientName: patientName.trim(),
            doctorName: doctorName.trim(),
            includeLogo,
            startingPosition,
            arabicFont,
            // Pass the custom labels array
            customLabels: labels.map(l => l.text)
        });
    };

    // Handle key press for new label input
    const handleNewLabelKeyPress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLabel();
        }
    };

    // Handle key press for edit label input
    const handleEditLabelKeyPress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEditLabel();
        } else if (e.key === 'Escape') {
            cancelEditLabel();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="label-preview-modal-overlay" onClick={onClose}>
            <div className="label-preview-modal label-preview-modal-wide" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="label-preview-header">
                    <h2>
                        <i className="fas fa-print"></i>
                        Print Aligner Labels
                    </h2>
                    <button className="modal-close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="label-preview-content">
                    {/* Left Column - Form */}
                    <div className="label-preview-form">
                        <h3>Label Information</h3>

                        {/* Patient Name */}
                        <div className="form-group">
                            <label>Patient Name</label>
                            <input
                                type="text"
                                value={patientName}
                                onChange={(e) => setPatientName(e.target.value)}
                                placeholder="Enter patient name"
                                className={!patientName.trim() ? 'input-error' : ''}
                            />
                        </div>

                        {/* Doctor Name - EDITABLE */}
                        <div className="form-group">
                            <label>Doctor Name</label>
                            <input
                                type="text"
                                value={doctorName}
                                onChange={(e) => setDoctorName(e.target.value)}
                                placeholder="Enter doctor name"
                                className={!doctorName.trim() ? 'input-error' : ''}
                            />
                        </div>

                        {/* Logo Toggle */}
                        <div className="form-group form-group-inline">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={includeLogo}
                                    onChange={(e) => setIncludeLogo(e.target.checked)}
                                />
                                <span className="checkbox-text">Include Logo on Labels</span>
                            </label>
                        </div>

                        {/* Arabic Font Selector */}
                        <div className="form-group">
                            <label>Arabic Font</label>
                            <select
                                value={arabicFont}
                                onChange={(e) => setArabicFont(e.target.value)}
                                className="font-selector"
                            >
                                {ARABIC_FONTS.map(font => (
                                    <option key={font.id} value={font.id}>
                                        {font.name} - {font.description}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Batch Info (read-only) */}
                        <div className="form-group">
                            <label>Source Batch</label>
                            <input
                                type="text"
                                value={`Batch #${batch?.BatchSequence || 'N/A'} (Set #${set?.SetSequence || 'N/A'})`}
                                disabled
                                className="input-disabled"
                            />
                        </div>

                        {/* Original Ranges Info */}
                        <div className="original-ranges-info">
                            <span className="info-label">Original ranges:</span>
                            {batch?.UpperAlignerStartSequence && batch?.UpperAlignerEndSequence && (
                                <span className="range-badge upper">
                                    U{batch.UpperAlignerStartSequence}-{batch.UpperAlignerEndSequence}
                                </span>
                            )}
                            {batch?.LowerAlignerStartSequence && batch?.LowerAlignerEndSequence && (
                                <span className="range-badge lower">
                                    L{batch.LowerAlignerStartSequence}-{batch.LowerAlignerEndSequence}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Middle Column - Labels Editor */}
                    <div className="label-preview-middle">
                        <div className="labels-editor">
                            <div className="labels-editor-header">
                                <h3>Labels to Print ({totalLabels})</h3>
                                <div className="labels-editor-actions">
                                    <button
                                        className="btn-reset-labels"
                                        onClick={resetToDefault}
                                        title="Reset to default labels from batch"
                                    >
                                        <i className="fas fa-undo"></i>
                                        Reset
                                    </button>
                                    <button
                                        className="btn-clear-labels"
                                        onClick={clearAllLabels}
                                        title="Clear all labels"
                                    >
                                        <i className="fas fa-trash"></i>
                                        Clear
                                    </button>
                                </div>
                            </div>

                            <p className="labels-hint">
                                <i className="fas fa-info-circle"></i>
                                Click to edit, × to remove. Use U#/L# format (e.g., U5/L5 for combined)
                            </p>

                            {/* Add New Label */}
                            <div className="add-label-row">
                                <input
                                    type="text"
                                    value={newLabelText}
                                    onChange={(e) => setNewLabelText(e.target.value)}
                                    onKeyPress={handleNewLabelKeyPress}
                                    placeholder="Add label (e.g., U7, L5, U3/L3)"
                                    className="add-label-input"
                                />
                                <button
                                    className="btn-add-label"
                                    onClick={addLabel}
                                    disabled={!newLabelText.trim()}
                                >
                                    <i className="fas fa-plus"></i>
                                </button>
                            </div>

                            {/* Labels List */}
                            <div className="labels-list">
                                {labels.length === 0 ? (
                                    <div className="no-labels">
                                        <i className="fas fa-inbox"></i>
                                        <p>No labels to print</p>
                                        <p className="hint">Add labels above or click Reset</p>
                                    </div>
                                ) : (
                                    labels.map((label, idx) => (
                                        <div
                                            key={label.id}
                                            className={`label-item ${label.type === 'UL' ? 'combined' : label.type === 'U' ? 'upper' : label.type === 'L' ? 'lower' : 'custom'}`}
                                        >
                                            <span className="label-index">{idx + 1}</span>
                                            {editingLabelId === label.id ? (
                                                <input
                                                    type="text"
                                                    value={editLabelText}
                                                    onChange={(e) => setEditLabelText(e.target.value)}
                                                    onKeyDown={handleEditLabelKeyPress}
                                                    onBlur={saveEditLabel}
                                                    className="label-edit-input"
                                                    autoFocus
                                                />
                                            ) : (
                                                <span
                                                    className="label-text"
                                                    onClick={() => startEditLabel(label)}
                                                    title="Click to edit"
                                                >
                                                    {label.text}
                                                </span>
                                            )}
                                            <button
                                                className="btn-remove-label"
                                                onClick={() => removeLabel(label.id)}
                                                title="Remove label"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Position & Stats */}
                    <div className="label-preview-right">
                        {/* Starting Position Selector */}
                        <div className="position-selector">
                            <h3>Starting Position</h3>
                            <p className="position-hint">Select where to start on the label sheet (OL291)</p>

                            <div className="position-grid">
                                {Array.from({ length: LABELS_PER_SHEET }, (_, i) => i + 1).map(pos => {
                                    const isSelected = pos === startingPosition;
                                    const labelsOnFirstPage = Math.min(totalLabels, LABELS_PER_SHEET - startingPosition + 1);
                                    const isUsed = pos >= startingPosition && pos < startingPosition + labelsOnFirstPage;

                                    return (
                                        <button
                                            key={pos}
                                            className={`position-cell ${isSelected ? 'selected' : ''} ${isUsed && !isSelected ? 'will-use' : ''}`}
                                            onClick={() => setStartingPosition(pos)}
                                            title={`Position ${pos}`}
                                        >
                                            {pos}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="position-legend">
                                <span className="legend-item">
                                    <span className="legend-color selected"></span>
                                    Start
                                </span>
                                <span className="legend-item">
                                    <span className="legend-color will-use"></span>
                                    Used
                                </span>
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="print-stats">
                            <div className="stat-item">
                                <span className="stat-label">Total Labels</span>
                                <span className="stat-value">{totalLabels}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Pages</span>
                                <span className="stat-value">{totalPages}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">Next Pos</span>
                                <span className="stat-value">{nextPosition}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="label-preview-footer">
                    <button className="btn-cancel" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn-generate"
                        onClick={handleGenerate}
                        disabled={!isValid || isGenerating}
                    >
                        {isGenerating ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Generating...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-file-pdf"></i>
                                Prepare PDF
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LabelPreviewModal;
