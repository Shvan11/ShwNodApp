import React, { useState } from 'react';

const WorkCard = ({
    work,
    patientId,
    isAlignerWork,
    isExpanded,
    onToggleExpanded,
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
        <div className={`work-card ${work.Finished ? 'work-card-completed' : 'work-card-active'} ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {/* Minimal Header - Always Visible */}
            <div className="work-card-collapsed-header" onClick={onToggleExpanded} style={{ cursor: 'pointer' }}>
                <div className="work-card-title-section">
                    <div className="work-card-title">
                        <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'}`} style={{ fontSize: '0.875rem', color: '#6b7280', marginRight: '0.5rem' }}></i>
                        <i className="fas fa-tooth"></i>
                        <h3>{work.TypeName || 'Other Treatment'}</h3>
                        {getStatusBadge()}
                    </div>
                    <div className="work-card-meta-minimal">
                        <span><i className="fas fa-user-md"></i> {work.DoctorName || 'Not assigned'}</span>
                        <span><i className="fas fa-calendar-plus"></i> {formatDate(work.AdditionDate)}</span>
                        {!isExpanded && getRemainingBalance() > 0 && (
                            <span className="balance-indicator" style={{ color: '#dc2626', fontWeight: '600' }}>
                                <i className="fas fa-exclamation-circle"></i> Balance: {formatCurrency(getRemainingBalance(), work.Currency)}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Full Content - Only Visible When Expanded */}
            {isExpanded && (
                <div className="work-card-full-content">
                    {/* Actions Menu */}
                    <div className="work-card-actions-menu">
                        <button
                            type="button"
                            className="btn-icon"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowActions(!showActions);
                            }}
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

                    {/* Additional Details */}
                    {(work.Notes || work.EstimatedDuration || work.DebondDate || work.StartDate) && (
                        <div className="work-card-additional-info">
                            {work.StartDate && (
                                <div className="info-item">
                                    <i className="fas fa-play-circle"></i>
                                    <span>Started: {formatDate(work.StartDate)}</span>
                                </div>
                            )}
                            {work.EstimatedDuration && (
                                <div className="info-item">
                                    <i className="fas fa-clock"></i>
                                    <span>Duration: {work.EstimatedDuration} months</span>
                                </div>
                            )}
                            {work.DebondDate && (
                                <div className="info-item">
                                    <i className="fas fa-calendar-check"></i>
                                    <span>Debond: {formatDate(work.DebondDate)}</span>
                                </div>
                            )}
                            {work.Notes && (
                                <div className="info-item full-width">
                                    <i className="fas fa-sticky-note"></i>
                                    <span>{work.Notes}</span>
                                </div>
                            )}
                        </div>
                    )}

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
                </div>
            )}
        </div>
    );
};

export default WorkCard;
