// BatchesSection.jsx - Batches display and management
import React, { useState } from 'react';

const BatchesSection = ({ batches, onUpdateDays, formatDate }) => {
    const [editingDays, setEditingDays] = useState({});
    const [daysValues, setDaysValues] = useState({});

    const handleStartEdit = (batchId, currentDays) => {
        setEditingDays(prev => ({ ...prev, [batchId]: true }));
        setDaysValues(prev => ({ ...prev, [batchId]: currentDays || '' }));
    };

    const handleSave = async (batchId) => {
        const newDays = parseInt(daysValues[batchId]);
        if (isNaN(newDays) || newDays < 1) {
            alert('Please enter a valid number of days (minimum 1)');
            return;
        }

        await onUpdateDays(batchId, newDays);
        setEditingDays(prev => ({ ...prev, [batchId]: false }));
    };

    const handleCancel = (batchId) => {
        setEditingDays(prev => ({ ...prev, [batchId]: false }));
        setDaysValues(prev => ({ ...prev, [batchId]: '' }));
    };

    return (
        <div className="batches-section">
            <h4>Batches</h4>
            {batches.map((batch) => {
                const isDelivered = batch.DeliveredToPatientDate !== null;

                return (
                    <div key={batch.AlignerBatchID} className={`batch-card ${isDelivered ? 'delivered' : ''}`}>
                        <div className="batch-header">
                            <div className="batch-title">Batch #{batch.BatchSequence}</div>
                            <span className={`batch-status ${isDelivered ? 'delivered' : 'pending'}`}>
                                {isDelivered ? 'Delivered' : 'Pending'}
                            </span>
                        </div>

                        <div className="batch-info-grid">
                            <div className="batch-info-item">
                                <i className="fas fa-teeth"></i>
                                Upper: {batch.UpperAlignerStartSequence}-{batch.UpperAlignerEndSequence} ({batch.UpperAlignerCount})
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-teeth"></i>
                                Lower: {batch.LowerAlignerStartSequence}-{batch.LowerAlignerEndSequence} ({batch.LowerAlignerCount})
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-industry"></i>
                                Manufactured: {formatDate(batch.ManufactureDate)}
                            </div>
                            {isDelivered && (
                                <div className="batch-info-item">
                                    <i className="fas fa-truck"></i>
                                    Delivered: {formatDate(batch.DeliveredToPatientDate)}
                                </div>
                            )}
                            <div className="batch-info-item">
                                <i className="fas fa-clock"></i>
                                <span>Days per Aligner: </span>
                                {editingDays[batch.AlignerBatchID] ? (
                                    <div className="days-editor">
                                        <input
                                            type="number"
                                            className="days-input"
                                            value={daysValues[batch.AlignerBatchID]}
                                            onChange={(e) => setDaysValues(prev => ({
                                                ...prev,
                                                [batch.AlignerBatchID]: e.target.value
                                            }))}
                                            min="1"
                                        />
                                        <button
                                            className="days-save-btn"
                                            onClick={() => handleSave(batch.AlignerBatchID)}
                                        >
                                            Save
                                        </button>
                                        <button
                                            className="btn-cancel"
                                            onClick={() => handleCancel(batch.AlignerBatchID)}
                                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <strong>{batch.Days || 'N/A'}</strong>
                                        <button
                                            onClick={() => handleStartEdit(batch.AlignerBatchID, batch.Days)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--portal-primary)',
                                                cursor: 'pointer',
                                                marginLeft: '0.5rem'
                                            }}
                                        >
                                            <i className="fas fa-edit"></i>
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="batch-info-item">
                                <i className="fas fa-hourglass-half"></i>
                                Validity: {batch.ValidityPeriod || 'N/A'} days
                            </div>
                            {batch.NextBatchReadyDate && (
                                <div className="batch-info-item">
                                    <i className="fas fa-calendar-check"></i>
                                    Next Batch: {formatDate(batch.NextBatchReadyDate)}
                                </div>
                            )}
                        </div>

                        {batch.Notes && (
                            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--portal-grey)' }}>
                                <i className="fas fa-sticky-note"></i> {batch.Notes}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default BatchesSection;
