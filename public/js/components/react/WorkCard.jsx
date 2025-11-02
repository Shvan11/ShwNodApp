import React, { useState } from 'react';

const WorkCard = ({
    work,
    patientId,
    isAlignerWork,
    onViewDetails,
    onEdit,
    onAddPayment,
    onViewPaymentHistory,
    onAddAlignerSet,
    onComplete,
    onViewVisits,
    onPrintReceipt,
    formatDate,
    formatCurrency,
    getProgressPercentage
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showActions, setShowActions] = useState(false);

    const getStatusBadge = () => {
        if (work.Finished) {
            return <span className="work-status-badge completed">Completed</span>;
        }
        return <span className="work-status-badge active">Active</span>;
    };

    const getRemainingBalance = () => {
        return (work.TotalRequired || 0) - (work.TotalPaid || 0);
    };

    const isFullyPaid = () => {
        return getRemainingBalance() <= 0;
    };

    return (
        <div className={`work-card ${work.Finished ? 'work-card-completed' : 'work-card-active'}`}>
            {/* Card Header */}
            <div className="work-card-header">
                <div className="work-card-title-section">
                    <div className="work-card-title">
                        <i className="fas fa-tooth"></i>
                        <h3>{work.TypeName || 'Other Treatment'}</h3>
                        {getStatusBadge()}
                    </div>
                    <div className="work-card-meta">
                        <span><i className="fas fa-user-md"></i> {work.DoctorName || 'Not assigned'}</span>
                        <span><i className="fas fa-calendar-plus"></i> Added: {formatDate(work.AdditionDate)}</span>
                        {work.StartDate && <span><i className="fas fa-play-circle"></i> Started: {formatDate(work.StartDate)}</span>}
                    </div>
                </div>
                <div className="work-card-actions-menu">
                    <button
                        type="button"
                        className="btn-icon"
                        onClick={() => setShowActions(!showActions)}
                        title="More actions"
                    >
                        <i className="fas fa-ellipsis-v"></i>
                    </button>
                    {showActions && (
                        <div className="work-card-dropdown">
                            <button type="button" onClick={() => { onEdit(work); setShowActions(false); }}>
                                <i className="fas fa-edit"></i> Edit Work
                            </button>
                            {!work.Finished && (
                                <button type="button" onClick={() => { onComplete(work.workid); setShowActions(false); }}>
                                    <i className="fas fa-check-circle"></i> Mark Complete
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Progress Section */}
            <div className="work-card-progress">
                <div className="progress-info">
                    <span className="progress-label">Treatment Progress</span>
                    <span className="progress-percentage">{getProgressPercentage(work)}%</span>
                </div>
                <div className="progress-bar-container">
                    <div
                        className="progress-bar-fill"
                        style={{ width: `${getProgressPercentage(work)}%` }}
                    ></div>
                </div>
            </div>

            {/* Financial Summary */}
            <div className="work-card-financial">
                <div className="financial-item">
                    <span className="financial-label">Total Cost</span>
                    <span className="financial-value">{formatCurrency(work.TotalRequired, work.Currency)}</span>
                </div>
                <div className="financial-item">
                    <span className="financial-label">Paid</span>
                    <span className="financial-value paid">{formatCurrency(work.TotalPaid, work.Currency)}</span>
                </div>
                <div className="financial-item">
                    <span className="financial-label">Remaining</span>
                    <span className={`financial-value ${isFullyPaid() ? 'paid-full' : 'remaining'}`}>
                        {formatCurrency(getRemainingBalance(), work.Currency)}
                    </span>
                </div>
            </div>

            {/* Primary Actions */}
            <div className="work-card-primary-actions">
                <button
                    type="button"
                    className="btn-card-action btn-visits"
                    onClick={() => onViewVisits(work)}
                    title="View visits for this work"
                >
                    <i className="fas fa-calendar-check"></i>
                    <span>Visits</span>
                </button>
                <button
                    type="button"
                    className="btn-card-action btn-payments"
                    onClick={() => onViewPaymentHistory(work)}
                    title="View payment history"
                >
                    <i className="fas fa-history"></i>
                    <span>Payments</span>
                </button>
                <button
                    type="button"
                    className="btn-card-action btn-details"
                    onClick={() => onViewDetails(work)}
                    title="View work details"
                >
                    <i className="fas fa-info-circle"></i>
                    <span>Details</span>
                </button>
            </div>

            {/* Secondary Actions */}
            <div className="work-card-secondary-actions">
                <button
                    type="button"
                    className={`btn-card-secondary btn-add-payment ${isFullyPaid() ? 'disabled' : ''}`}
                    onClick={() => !isFullyPaid() && onAddPayment(work)}
                    disabled={isFullyPaid()}
                    title={isFullyPaid() ? "No balance remaining" : "Add payment for this work"}
                >
                    <i className="fas fa-dollar-sign"></i>
                    <span>Add Payment</span>
                </button>
                <button
                    type="button"
                    className="btn-card-secondary btn-print-receipt"
                    onClick={() => onPrintReceipt(work)}
                    title="Print today's receipt"
                >
                    <i className="fas fa-print"></i>
                    <span>Print Receipt</span>
                </button>
                {isAlignerWork(work) && (
                    <button
                        type="button"
                        className="btn-card-secondary btn-add-set"
                        onClick={() => onAddAlignerSet(work)}
                        title="Add or manage aligner sets"
                    >
                        <i className="fas fa-tooth"></i>
                        <span>Add Aligner Set</span>
                    </button>
                )}
            </div>

            {/* Expandable Details Section */}
            {isExpanded && (
                <div className="work-card-expanded">
                    <div className="work-card-detail-section">
                        <h4><i className="fas fa-info-circle"></i> Additional Information</h4>
                        {work.Notes && (
                            <div className="detail-item">
                                <span className="detail-label">Notes:</span>
                                <span className="detail-value">{work.Notes}</span>
                            </div>
                        )}
                        {work.EstimatedDuration && (
                            <div className="detail-item">
                                <span className="detail-label">Duration:</span>
                                <span className="detail-value">{work.EstimatedDuration} months</span>
                            </div>
                        )}
                        {work.DebondDate && (
                            <div className="detail-item">
                                <span className="detail-label">Debond Date:</span>
                                <span className="detail-value">{formatDate(work.DebondDate)}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Expand/Collapse Toggle */}
            <button
                type="button"
                className="work-card-expand-toggle"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                <span>{isExpanded ? 'Show Less' : 'Show More'}</span>
            </button>
        </div>
    );
};

export default WorkCard;
