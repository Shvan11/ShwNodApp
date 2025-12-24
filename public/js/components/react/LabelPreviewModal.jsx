/**
 * LabelPreviewModal - Modal for previewing and editing aligner labels before printing
 *
 * Works in two modes:
 * - Single batch mode: Opened from PatientSets with a specific batch
 * - Queue mode: Opened from PrintQueueIndicator with multiple batches
 *
 * Both modes use the same rich label format for consistency.
 *
 * @module LabelPreviewModal
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';

const LABELS_PER_SHEET = 12;

// Available Arabic fonts
const ARABIC_FONTS = [
    { id: 'cairo', name: 'Cairo', description: 'Modern, clean' },
    { id: 'noto', name: 'Noto Sans Arabic', description: 'Standard' },
];

/**
 * Build default labels from batch upper/lower ranges
 */
function buildLabelsFromRanges(upperStart, upperEnd, lowerStart, lowerEnd) {
    const labelMap = new Map();

    if (upperStart != null && upperEnd != null && upperStart >= 0) {
        for (let i = upperStart; i <= upperEnd; i++) {
            labelMap.set(i, 'U');
        }
    }

    if (lowerStart != null && lowerEnd != null && lowerStart >= 0) {
        for (let i = lowerStart; i <= lowerEnd; i++) {
            labelMap.set(i, labelMap.has(i) ? 'UL' : 'L');
        }
    }

    const labels = [];
    const sortedKeys = Array.from(labelMap.keys()).sort((a, b) => a - b);

    for (const seq of sortedKeys) {
        const type = labelMap.get(seq);
        let text;
        if (type === 'U') text = `U${seq}`;
        else if (type === 'L') text = `L${seq}`;
        else text = `U${seq}/L${seq}`;

        labels.push({ id: `${type}-${seq}`, text, type });
    }

    return labels;
}

/**
 * Calculate pages needed and next position
 */
function calculateStats(totalLabels, startingPosition) {
    if (totalLabels === 0) return { pages: 0, nextPosition: startingPosition };

    const availableFirstPage = LABELS_PER_SHEET - startingPosition + 1;
    const pages = totalLabels <= availableFirstPage
        ? 1
        : 1 + Math.ceil((totalLabels - availableFirstPage) / LABELS_PER_SHEET);

    const finalPosition = startingPosition + totalLabels - 1;
    const nextPosition = (finalPosition % LABELS_PER_SHEET) + 1;

    return { pages, nextPosition };
}

/**
 * Determine label type from text
 */
function getLabelType(text) {
    if (text.includes('/')) return 'UL';
    if (text.toUpperCase().startsWith('U')) return 'U';
    if (text.toUpperCase().startsWith('L')) return 'L';
    return 'custom';
}

const LabelPreviewModal = ({
    // Single batch mode props
    isOpen,
    onClose,
    onGenerate,
    batch,
    set,
    patient,
    doctorName: initialDoctorName,
    isGenerating = false,
    // Queue mode props
    queueMode = false,
    queuedItems = [],
    onQueuePrintSuccess
}) => {
    const toast = useToast();

    // Shared state
    const [startingPosition, setStartingPosition] = useState(1);
    const [arabicFont, setArabicFont] = useState('cairo');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Single batch mode state
    const [patientName, setPatientName] = useState('');
    const [doctorName, setDoctorName] = useState('');
    const [includeLogo, setIncludeLogo] = useState(true);
    const [labels, setLabels] = useState([]);
    const [newLabelText, setNewLabelText] = useState('');
    const [editingLabelId, setEditingLabelId] = useState(null);
    const [editLabelText, setEditLabelText] = useState('');

    // Queue mode state
    const [queueBatches, setQueueBatches] = useState([]);
    const [expandedBatchId, setExpandedBatchId] = useState(null);
    const [queueNewLabelText, setQueueNewLabelText] = useState('');
    const [queueEditingLabel, setQueueEditingLabel] = useState(null); // { batchId, labelIndex }
    const [queueEditLabelText, setQueueEditLabelText] = useState('');

    // Determine if modal should show
    const isModalOpen = queueMode ? queuedItems.length > 0 : isOpen;

    // Initialize single batch mode
    useEffect(() => {
        if (!queueMode && isOpen && batch && patient) {
            const name = patient.PatientName ||
                (patient.FirstName && patient.LastName
                    ? `${patient.FirstName} ${patient.LastName}`
                    : 'Unknown Patient');
            setPatientName(name);

            const drName = initialDoctorName || '';
            setDoctorName(drName.startsWith('Dr.') || drName.startsWith('Dr ') ? drName : `Dr. ${drName}`);
            setIncludeLogo(true);

            const defaultLabels = buildLabelsFromRanges(
                batch.UpperAlignerStartSequence,
                batch.UpperAlignerEndSequence,
                batch.LowerAlignerStartSequence,
                batch.LowerAlignerEndSequence
            );
            setLabels(defaultLabels);
            setStartingPosition(1);
            setArabicFont('cairo');
            setNewLabelText('');
            setEditingLabelId(null);
        }
    }, [queueMode, isOpen, batch, patient, initialDoctorName]);

    // Initialize queue mode
    useEffect(() => {
        if (queueMode && queuedItems.length > 0) {
            const batches = queuedItems.map(item => ({
                ...item,
                includeLogo: item.includeLogo !== undefined ? item.includeLogo : !!item.doctorLogoPath,
                originalLabels: [...item.labels] // Store original for reset
            }));
            setQueueBatches(batches);
            setStartingPosition(1);
            setArabicFont('cairo');
            setExpandedBatchId(null);
            setQueueNewLabelText('');
            setQueueEditingLabel(null);
        }
    }, [queueMode, queuedItems]);

    // Calculate totals
    const totalLabels = queueMode
        ? queueBatches.reduce((sum, b) => sum + b.labels.length, 0)
        : labels.length;

    const { pages: totalPages, nextPosition } = calculateStats(totalLabels, startingPosition);

    // Validation
    const isValid = queueMode
        ? queueBatches.length > 0 && totalLabels > 0
        : patientName.trim() !== '' && doctorName.trim() !== '' && labels.length > 0;

    // Group queue batches by patient
    const groupedQueueBatches = useMemo(() => {
        if (!queueMode) return [];
        const groups = {};
        queueBatches.forEach(batch => {
            if (!groups[batch.patientId]) {
                groups[batch.patientId] = {
                    patientId: batch.patientId,
                    patientName: batch.patientName,
                    batches: []
                };
            }
            groups[batch.patientId].batches.push(batch);
        });
        return Object.values(groups);
    }, [queueMode, queueBatches]);

    // Queue stats
    const queueStats = useMemo(() => {
        if (!queueMode) return null;
        return {
            batchCount: queueBatches.length,
            patientCount: new Set(queueBatches.map(b => b.patientId)).size,
            totalLabels
        };
    }, [queueMode, queueBatches, totalLabels]);

    // Single batch: Label management
    const addLabel = useCallback(() => {
        const text = newLabelText.trim().toUpperCase();
        if (!text) return;

        setLabels(prev => [...prev, {
            id: `custom-${Date.now()}`,
            text,
            type: getLabelType(text)
        }]);
        setNewLabelText('');
    }, [newLabelText]);

    const removeLabel = useCallback((id) => {
        setLabels(prev => prev.filter(l => l.id !== id));
    }, []);

    const startEditLabel = useCallback((label) => {
        setEditingLabelId(label.id);
        setEditLabelText(label.text);
    }, []);

    const saveEditLabel = useCallback(() => {
        if (!editLabelText.trim()) {
            setLabels(prev => prev.filter(l => l.id !== editingLabelId));
        } else {
            const text = editLabelText.trim().toUpperCase();
            setLabels(prev => prev.map(l =>
                l.id === editingLabelId ? { ...l, text, type: getLabelType(text) } : l
            ));
        }
        setEditingLabelId(null);
        setEditLabelText('');
    }, [editingLabelId, editLabelText]);

    const resetToDefault = useCallback(() => {
        if (batch) {
            setLabels(buildLabelsFromRanges(
                batch.UpperAlignerStartSequence,
                batch.UpperAlignerEndSequence,
                batch.LowerAlignerStartSequence,
                batch.LowerAlignerEndSequence
            ));
        }
    }, [batch]);

    // Queue mode: Toggle logo for batch
    const toggleQueueBatchLogo = useCallback((batchId) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, includeLogo: !b.includeLogo } : b
        ));
    }, []);

    // Queue mode: Remove batch
    const removeQueueBatch = useCallback((batchId) => {
        setQueueBatches(prev => prev.filter(b => b.id !== batchId));
        if (expandedBatchId === batchId) {
            setExpandedBatchId(null);
        }
    }, [expandedBatchId]);

    // Queue mode: Toggle batch expansion
    const toggleBatchExpansion = useCallback((batchId) => {
        setExpandedBatchId(prev => prev === batchId ? null : batchId);
        setQueueNewLabelText('');
        setQueueEditingLabel(null);
    }, []);

    // Queue mode: Add label to batch
    const addLabelToQueueBatch = useCallback((batchId) => {
        const text = queueNewLabelText.trim().toUpperCase();
        if (!text) return;

        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [...b.labels, text] } : b
        ));
        setQueueNewLabelText('');
    }, [queueNewLabelText]);

    // Queue mode: Remove label from batch
    const removeLabelFromQueueBatch = useCallback((batchId, labelIndex) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId
                ? { ...b, labels: b.labels.filter((_, idx) => idx !== labelIndex) }
                : b
        ));
    }, []);

    // Queue mode: Start editing a label
    const startQueueLabelEdit = useCallback((batchId, labelIndex, currentText) => {
        setQueueEditingLabel({ batchId, labelIndex });
        setQueueEditLabelText(currentText);
    }, []);

    // Queue mode: Save edited label
    const saveQueueLabelEdit = useCallback(() => {
        if (!queueEditingLabel) return;

        const { batchId, labelIndex } = queueEditingLabel;
        const text = queueEditLabelText.trim().toUpperCase();

        if (!text) {
            // Empty text = remove the label
            removeLabelFromQueueBatch(batchId, labelIndex);
        } else {
            setQueueBatches(prev => prev.map(b =>
                b.id === batchId
                    ? { ...b, labels: b.labels.map((l, idx) => idx === labelIndex ? text : l) }
                    : b
            ));
        }
        setQueueEditingLabel(null);
        setQueueEditLabelText('');
    }, [queueEditingLabel, queueEditLabelText, removeLabelFromQueueBatch]);

    // Queue mode: Cancel editing
    const cancelQueueLabelEdit = useCallback(() => {
        setQueueEditingLabel(null);
        setQueueEditLabelText('');
    }, []);

    // Queue mode: Reset batch labels to original
    const resetQueueBatchLabels = useCallback((batchId) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [...b.originalLabels] } : b
        ));
    }, []);

    // Queue mode: Clear all labels from batch
    const clearQueueBatchLabels = useCallback((batchId) => {
        setQueueBatches(prev => prev.map(b =>
            b.id === batchId ? { ...b, labels: [] } : b
        ));
    }, []);

    /**
     * Build rich labels array from current state
     * Works for both single batch and queue mode
     */
    const buildRichLabels = useCallback(() => {
        if (queueMode) {
            // Queue mode: flatten all batches into rich labels
            const richLabels = [];
            queueBatches.forEach(batch => {
                batch.labels.forEach(labelText => {
                    richLabels.push({
                        text: labelText,
                        patientName: batch.patientName,
                        doctorName: batch.doctorName || '',
                        includeLogo: batch.includeLogo
                    });
                });
            });
            return richLabels;
        } else {
            // Single batch mode: all labels share same patient/doctor
            return labels.map(label => ({
                text: label.text,
                patientName: patientName.trim(),
                doctorName: doctorName.trim(),
                includeLogo
            }));
        }
    }, [queueMode, queueBatches, labels, patientName, doctorName, includeLogo]);

    /**
     * Unified generate handler for both modes
     */
    const handleGenerate = useCallback(async () => {
        if (!isValid) return;

        setIsSubmitting(true);

        try {
            const richLabels = buildRichLabels();

            const response = await fetch('/api/aligner/labels/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    labels: richLabels,
                    startingPosition,
                    arabicFont
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to generate labels');
            }

            // Open PDF in new tab
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');

            const totalLabelsHeader = response.headers.get('X-Total-Labels');
            const totalPagesHeader = response.headers.get('X-Total-Pages');
            toast.success(`Generated ${totalLabelsHeader || richLabels.length} labels on ${totalPagesHeader || '?'} page(s)`);

            // Close modal and clear queue if in queue mode
            if (queueMode && onQueuePrintSuccess) {
                onQueuePrintSuccess();
            } else if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Generate error:', error);
            toast.error('Failed to generate labels: ' + error.message);
        } finally {
            setIsSubmitting(false);
        }
    }, [isValid, buildRichLabels, startingPosition, arabicFont, queueMode, onQueuePrintSuccess, onClose, toast]);

    // Key handlers - Single batch mode
    const handleNewLabelKeyPress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLabel();
        }
    };

    const handleEditLabelKeyPress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEditLabel();
        } else if (e.key === 'Escape') {
            setEditingLabelId(null);
            setEditLabelText('');
        }
    };

    // Key handlers - Queue mode
    const handleQueueNewLabelKeyDown = (e, batchId) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addLabelToQueueBatch(batchId);
        }
    };

    const handleQueueEditLabelKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveQueueLabelEdit();
        } else if (e.key === 'Escape') {
            cancelQueueLabelEdit();
        }
    };

    // Get label type for styling
    const getQueueLabelType = (text) => {
        if (text.includes('/')) return 'combined';
        if (text.toUpperCase().startsWith('U')) return 'upper';
        if (text.toUpperCase().startsWith('L')) return 'lower';
        return 'custom';
    };

    if (!isModalOpen) return null;

    const currentIsGenerating = isSubmitting || isGenerating;

    // Shared: Position selector and stats
    const renderPositionAndStats = () => (
        <div className="label-preview-right">
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
    );

    // Queue mode render
    if (queueMode) {
        return (
            <div className="label-preview-modal-overlay" onClick={onClose}>
                <div className="label-preview-modal label-preview-modal-wide" onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div className="label-preview-header queue-mode-header">
                        <h2>
                            <i className="fas fa-layer-group"></i>
                            Print Queue
                            <span className="queue-header-stats">
                                {queueStats?.patientCount} {queueStats?.patientCount === 1 ? 'patient' : 'patients'} &bull; {queueStats?.batchCount} {queueStats?.batchCount === 1 ? 'batch' : 'batches'} &bull; {queueStats?.totalLabels} labels
                            </span>
                        </h2>
                        <button className="modal-close-btn" onClick={onClose}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="label-preview-content queue-mode-content">
                        {/* Left: Queue batches */}
                        <div className="label-preview-queue-batches">
                            <h3>Batches to Print</h3>
                            <p className="queue-hint">
                                <i className="fas fa-info-circle"></i>
                                Click batch to expand and edit labels. Labels are printed in order shown.
                            </p>

                            <div className="queue-patient-groups">
                                {groupedQueueBatches.map(group => (
                                    <div key={group.patientId} className="queue-patient-group">
                                        <div className="queue-patient-header">
                                            <i className="fas fa-user"></i>
                                            <span className="queue-patient-name">{group.patientName}</span>
                                        </div>
                                        <div className="queue-patient-batches">
                                            {group.batches.map(batch => {
                                                const isExpanded = expandedBatchId === batch.id;
                                                return (
                                                    <div key={batch.id} className={`queue-batch-item ${isExpanded ? 'expanded' : ''}`}>
                                                        {/* Batch header - clickable to expand */}
                                                        <div
                                                            className="queue-batch-header"
                                                            onClick={() => toggleBatchExpansion(batch.id)}
                                                        >
                                                            <div className="queue-batch-info">
                                                                <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} expand-icon`}></i>
                                                                <span className="queue-batch-number">Batch #{batch.batchNumber}</span>
                                                                <span className="queue-batch-labels">{batch.labels.length} labels</span>
                                                                {batch.doctorName && (
                                                                    <span className="queue-batch-doctor">{batch.doctorName}</span>
                                                                )}
                                                            </div>
                                                            <div className="queue-batch-actions" onClick={e => e.stopPropagation()}>
                                                                <label className="queue-logo-toggle" title="Include logo">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={batch.includeLogo}
                                                                        onChange={() => toggleQueueBatchLogo(batch.id)}
                                                                    />
                                                                    <span className="checkbox-icon">
                                                                        <i className={batch.includeLogo ? 'fas fa-image' : 'far fa-image'}></i>
                                                                    </span>
                                                                </label>
                                                                <button
                                                                    className="queue-batch-remove"
                                                                    onClick={() => removeQueueBatch(batch.id)}
                                                                    title="Remove batch"
                                                                >
                                                                    <i className="fas fa-trash"></i>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Collapsed view - show label chips */}
                                                        {!isExpanded && (
                                                            <div className="queue-batch-label-list">
                                                                {batch.labels.map((label, idx) => (
                                                                    <span key={idx} className={`queue-label-chip ${getQueueLabelType(label)}`}>{label}</span>
                                                                ))}
                                                                {batch.labels.length === 0 && (
                                                                    <span className="queue-no-labels">No labels</span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Expanded view - full label editor */}
                                                        {isExpanded && (
                                                            <div className="queue-batch-editor">
                                                                {/* Combined header: Title + Add input + Actions */}
                                                                <div className="queue-editor-header">
                                                                    <span className="editor-title">Labels ({batch.labels.length})</span>
                                                                    <input
                                                                        type="text"
                                                                        value={queueNewLabelText}
                                                                        onChange={(e) => setQueueNewLabelText(e.target.value)}
                                                                        onKeyDown={(e) => handleQueueNewLabelKeyDown(e, batch.id)}
                                                                        placeholder="Add (U7, L5...)"
                                                                        className="add-label-input"
                                                                    />
                                                                    <button
                                                                        className="btn-add-label"
                                                                        onClick={() => addLabelToQueueBatch(batch.id)}
                                                                        disabled={!queueNewLabelText.trim()}
                                                                        title="Add label"
                                                                    >
                                                                        <i className="fas fa-plus"></i>
                                                                    </button>
                                                                    <div className="queue-editor-actions">
                                                                        <button
                                                                            className="btn-reset-labels"
                                                                            onClick={() => resetQueueBatchLabels(batch.id)}
                                                                            title="Reset to original"
                                                                        >
                                                                            <i className="fas fa-undo"></i>
                                                                        </button>
                                                                        <button
                                                                            className="btn-clear-labels"
                                                                            onClick={() => clearQueueBatchLabels(batch.id)}
                                                                            title="Clear all"
                                                                        >
                                                                            <i className="fas fa-trash"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* Labels list */}
                                                                <div className="queue-labels-list">
                                                                    {batch.labels.length === 0 ? (
                                                                        <div className="no-labels">
                                                                            <i className="fas fa-inbox"></i>
                                                                            <p>No labels</p>
                                                                            <p className="hint">Add labels above or click Reset</p>
                                                                        </div>
                                                                    ) : (
                                                                        batch.labels.map((label, idx) => {
                                                                            const isEditing = queueEditingLabel?.batchId === batch.id && queueEditingLabel?.labelIndex === idx;
                                                                            return (
                                                                                <div
                                                                                    key={idx}
                                                                                    className={`label-item ${getQueueLabelType(label)}`}
                                                                                >
                                                                                    <span className="label-index">{idx + 1}</span>
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="text"
                                                                                            value={queueEditLabelText}
                                                                                            onChange={(e) => setQueueEditLabelText(e.target.value)}
                                                                                            onKeyDown={handleQueueEditLabelKeyDown}
                                                                                            onBlur={saveQueueLabelEdit}
                                                                                            className="label-edit-input"
                                                                                            autoFocus
                                                                                        />
                                                                                    ) : (
                                                                                        <span
                                                                                            className="label-text"
                                                                                            onClick={() => startQueueLabelEdit(batch.id, idx, label)}
                                                                                            title="Click to edit"
                                                                                        >
                                                                                            {label}
                                                                                        </span>
                                                                                    )}
                                                                                    <button
                                                                                        className="btn-remove-label"
                                                                                        onClick={() => removeLabelFromQueueBatch(batch.id, idx)}
                                                                                        title="Remove"
                                                                                    >
                                                                                        <i className="fas fa-times"></i>
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        })
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {queueBatches.length === 0 && (
                                <div className="queue-empty">
                                    <i className="fas fa-inbox"></i>
                                    <p>No batches in queue</p>
                                </div>
                            )}
                        </div>

                        {/* Right: Position & Stats */}
                        {renderPositionAndStats()}
                    </div>

                    {/* Footer */}
                    <div className="label-preview-footer">
                        <button className="btn-cancel" onClick={onClose}>Cancel</button>
                        <button
                            className="btn-generate"
                            onClick={handleGenerate}
                            disabled={!isValid || currentIsGenerating}
                        >
                            {currentIsGenerating ? (
                                <><i className="fas fa-spinner fa-spin"></i> Generating...</>
                            ) : (
                                <><i className="fas fa-file-pdf"></i> Print All Labels ({totalLabels})</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Single batch mode render
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
                    {/* Left: Form */}
                    <div className="label-preview-form">
                        <h3>Label Information</h3>

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

                        <div className="form-group">
                            <label>Source Batch</label>
                            <input
                                type="text"
                                value={`Batch #${batch?.BatchSequence || 'N/A'} (Set #${set?.SetSequence || 'N/A'})`}
                                disabled
                                className="input-disabled"
                            />
                        </div>

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

                    {/* Middle: Labels Editor */}
                    <div className="label-preview-middle">
                        <div className="labels-editor">
                            <div className="labels-editor-header">
                                <h3>Labels to Print ({totalLabels})</h3>
                                <div className="labels-editor-actions">
                                    <button className="btn-reset-labels" onClick={resetToDefault} title="Reset">
                                        <i className="fas fa-undo"></i> Reset
                                    </button>
                                    <button className="btn-clear-labels" onClick={() => setLabels([])} title="Clear">
                                        <i className="fas fa-trash"></i> Clear
                                    </button>
                                </div>
                            </div>

                            <p className="labels-hint">
                                <i className="fas fa-info-circle"></i>
                                Click to edit, x to remove. Use U#/L# format
                            </p>

                            <div className="add-label-row">
                                <input
                                    type="text"
                                    value={newLabelText}
                                    onChange={(e) => setNewLabelText(e.target.value)}
                                    onKeyPress={handleNewLabelKeyPress}
                                    placeholder="Add label (e.g., U7, L5, U3/L3)"
                                    className="add-label-input"
                                />
                                <button className="btn-add-label" onClick={addLabel} disabled={!newLabelText.trim()}>
                                    <i className="fas fa-plus"></i>
                                </button>
                            </div>

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
                                                <span className="label-text" onClick={() => startEditLabel(label)} title="Click to edit">
                                                    {label.text}
                                                </span>
                                            )}
                                            <button className="btn-remove-label" onClick={() => removeLabel(label.id)} title="Remove">
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Position & Stats */}
                    {renderPositionAndStats()}
                </div>

                {/* Footer */}
                <div className="label-preview-footer">
                    <button className="btn-cancel" onClick={onClose}>Cancel</button>
                    <button
                        className="btn-generate"
                        onClick={handleGenerate}
                        disabled={!isValid || currentIsGenerating}
                    >
                        {currentIsGenerating ? (
                            <><i className="fas fa-spinner fa-spin"></i> Generating...</>
                        ) : (
                            <><i className="fas fa-file-pdf"></i> Prepare PDF</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LabelPreviewModal;
