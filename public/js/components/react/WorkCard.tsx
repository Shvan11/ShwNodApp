import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import cn from 'classnames';
import { isOrthoWork, needsDetails } from '../../config/workTypeConfig';
import styles from './WorkCard.module.css';

export interface Work {
    workid: number;
    PersonID: number;
    Typeofwork: number;
    TypeName?: string;
    Status: number;
    TotalRequired?: number;
    TotalPaid?: number;
    Currency?: 'USD' | 'IQD';
    AdditionDate?: string;
    StartDate?: string;
    DebondDate?: string;
    EstimatedDuration?: number;
    DrID?: number;
    DoctorName?: string;
    Notes?: string;
    KeyWordID1?: number;
    KeyWordID2?: number;
    KeywordID3?: number;
    KeywordID4?: number;
    KeywordID5?: number;
}

export interface WorkStatus {
    ACTIVE: number;
    FINISHED: number;
    DISCONTINUED: number;
}

interface WorkCardProps {
    work: Work;
    personId?: number | null;
    isAlignerWork: (work: Work) => boolean;
    isExpanded: boolean;
    onToggleExpanded: () => void;
    onViewDetails: (work: Work) => void;
    onEdit: (work: Work) => void;
    onDelete: (work: Work) => void;
    onAddPayment: (work: Work) => void;
    onViewPaymentHistory: (work: Work) => void;
    onAddAlignerSet: (work: Work) => void;
    onComplete: (workId: number) => void;
    onDiscontinue: (workId: number) => void;
    onReactivate: (work: Work) => void;
    onViewVisits: (work: Work) => void;
    onNewVisit: (work: Work) => void;
    onPrintReceipt: (work: Work) => void;
    formatDate: (date?: string) => string;
    formatCurrency: (amount?: number, currency?: string) => string;
    getProgressPercentage: (work: Work) => number;
    WORK_STATUS: WorkStatus;
}

const WorkCard = ({
    work,
    personId,
    isAlignerWork,
    isExpanded,
    onToggleExpanded,
    onViewDetails,
    onEdit,
    onDelete,
    onAddPayment,
    onViewPaymentHistory,
    onAddAlignerSet,
    onComplete,
    onDiscontinue,
    onReactivate,
    onViewVisits,
    onNewVisit,
    onPrintReceipt,
    formatDate,
    formatCurrency,
    getProgressPercentage,
    WORK_STATUS
}: WorkCardProps) => {
    const navigate = useNavigate();
    const [showActions, setShowActions] = useState(false);

    const getStatusBadge = () => {
        if (work.Status === WORK_STATUS.FINISHED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeCompleted)}>Completed</span>;
        }
        if (work.Status === WORK_STATUS.DISCONTINUED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeDiscontinued)}>Discontinued</span>;
        }
        return <span className={cn(styles.statusBadge, styles.statusBadgeActive)}>Active</span>;
    };

    const isActive = work.Status === WORK_STATUS.ACTIVE;
    const isFinished = work.Status === WORK_STATUS.FINISHED;
    const isDiscontinued = work.Status === WORK_STATUS.DISCONTINUED;

    const getRemainingBalance = (): number => {
        return (work.TotalRequired || 0) - (work.TotalPaid || 0);
    };

    const isFullyPaid = (): boolean => {
        return getRemainingBalance() <= 0;
    };

    const getCardClass = (): string => {
        if (isDiscontinued) return styles.discontinued;
        if (isFinished) return styles.completed;
        return styles.active;
    };

    return (
        <div className={cn(styles.card, getCardClass(), isExpanded ? styles.expanded : styles.collapsed)}>
            {/* Minimal Header - Always Visible */}
            <div className={styles.collapsedHeader} onClick={onToggleExpanded}>
                <div className={styles.titleSection}>
                    <div className={styles.title}>
                        <i className={cn('fas', isExpanded ? 'fa-chevron-down' : 'fa-chevron-right', styles.chevronIcon)}></i>
                        <i className="fas fa-tooth"></i>
                        <h3>{work.TypeName || 'Other Treatment'}</h3>
                        {getStatusBadge()}
                    </div>
                    <div className={styles.metaMinimal}>
                        <span><i className="fas fa-user-md"></i> {work.DoctorName ? (work.DoctorName === 'Admin' ? work.DoctorName : `Dr. ${work.DoctorName}`) : 'Not assigned'}</span>
                        <span><i className="fas fa-calendar-plus"></i> {formatDate(work.AdditionDate)}</span>
                        {!isExpanded && getRemainingBalance() > 0 && (
                            <span className={styles.balanceIndicator}>
                                <i className="fas fa-exclamation-circle"></i> Balance: {formatCurrency(getRemainingBalance(), work.Currency)}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Actions Menu - Show when expanded */}
            {isExpanded && (
                <div className={styles.actionsMenu}>
                    <button
                        type="button"
                        className="btn-icon"
                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            setShowActions(!showActions);
                        }}
                        title="More actions"
                    >
                        <i className="fas fa-ellipsis-v"></i>
                    </button>
                    {showActions && (
                        <div className={styles.dropdown}>
                            <button type="button" onClick={() => { onEdit(work); setShowActions(false); }}>
                                <i className="fas fa-edit"></i> Edit Work
                            </button>
                            {isActive && (
                                <>
                                    <button type="button" onClick={() => { onComplete(work.workid); setShowActions(false); }}>
                                        <i className="fas fa-check-circle"></i> Mark Complete
                                    </button>
                                    <button type="button" onClick={() => { onDiscontinue(work.workid); setShowActions(false); }}>
                                        <i className="fas fa-ban"></i> Mark Discontinued
                                    </button>
                                </>
                            )}
                            {(isFinished || isDiscontinued) && (
                                <button type="button" onClick={() => { onReactivate(work); setShowActions(false); }}>
                                    <i className="fas fa-redo"></i> Reactivate
                                </button>
                            )}
                            <button
                                type="button"
                                className={styles.dropdownDeleteBtn}
                                onClick={() => { onDelete(work); setShowActions(false); }}
                            >
                                <i className="fas fa-trash-alt"></i> Delete Work
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Full Content - Only Visible When Expanded */}
            {isExpanded && (
                <div className={styles.fullContent}>
                    {/* Progress Section */}
                    <div className={styles.progress}>
                        <div className={styles.progressInfo}>
                            <span className={styles.progressLabel}>Treatment Progress</span>
                            <span className={styles.progressPercentage}>{getProgressPercentage(work)}%</span>
                        </div>
                        <div className={styles.progressBarContainer}>
                            <div
                                className={styles.progressBarFill}
                                style={{ width: `${getProgressPercentage(work)}%` }}
                            ></div>
                        </div>
                    </div>

                    {/* Financial Summary */}
                    <div className={styles.financial}>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>Total Cost</span>
                            <span className={styles.financialValue}>{formatCurrency(work.TotalRequired, work.Currency)}</span>
                        </div>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>Paid</span>
                            <span className={cn(styles.financialValue, styles.financialValuePaid)}>{formatCurrency(work.TotalPaid, work.Currency)}</span>
                        </div>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>Remaining</span>
                            <span className={cn(styles.financialValue, isFullyPaid() ? styles.financialValuePaidFull : styles.financialValueRemaining)}>
                                {formatCurrency(getRemainingBalance(), work.Currency)}
                            </span>
                        </div>
                    </div>

                    {/* Additional Details */}
                    {(work.Notes || work.EstimatedDuration || work.DebondDate || work.StartDate) && (
                        <div className={styles.additionalInfo}>
                            {work.StartDate && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-play-circle"></i>
                                    <span>Started: {formatDate(work.StartDate)}</span>
                                </div>
                            )}
                            {work.EstimatedDuration && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-clock"></i>
                                    <span>Duration: {work.EstimatedDuration} months</span>
                                </div>
                            )}
                            {work.DebondDate && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-calendar-check"></i>
                                    <span>Debond: {formatDate(work.DebondDate)}</span>
                                </div>
                            )}
                            {work.Notes && (
                                <div className={cn(styles.infoItem, styles.infoItemFullWidth)}>
                                    <i className="fas fa-sticky-note"></i>
                                    <span>{work.Notes}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Primary Actions - Conditionally show based on work type */}
                    <div className={styles.primaryActions}>
                        {/* Visits & Diagnosis only for ortho-related works */}
                        {isOrthoWork(work.Typeofwork) && (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-new-visit"
                                    onClick={() => onNewVisit(work)}
                                    title="Add new visit for this work"
                                >
                                    <i className="fas fa-plus-circle"></i>
                                    <span>New Visit</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-visits"
                                    onClick={() => onViewVisits(work)}
                                    title="View visits for this work"
                                >
                                    <i className="fas fa-calendar-check"></i>
                                    <span>Visits</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-diagnosis"
                                    onClick={() => navigate(`/patient/${personId}/work/${work.workid}/diagnosis`)}
                                    title="View diagnosis and treatment plan"
                                >
                                    <i className="fas fa-stethoscope"></i>
                                    <span>Diagnosis</span>
                                </button>
                            </>
                        )}

                        {/* Payments - always visible */}
                        <button
                            type="button"
                            className="btn btn-card-action btn-payments"
                            onClick={() => onViewPaymentHistory(work)}
                            title="View payment history"
                        >
                            <i className="fas fa-history"></i>
                            <span>Payments</span>
                        </button>

                        {/* Details only for non-ortho works that need treatment items */}
                        {needsDetails(work.Typeofwork) && (
                            <button
                                type="button"
                                className="btn btn-card-action btn-details"
                                onClick={() => onViewDetails(work)}
                                title="View treatment details"
                            >
                                <i className="fas fa-list-alt"></i>
                                <span>Details</span>
                            </button>
                        )}
                    </div>

                    {/* Secondary Actions */}
                    <div className={styles.secondaryActions}>
                        <button
                            type="button"
                            className={cn('btn btn-card-secondary btn-add-payment', isFullyPaid() && 'disabled')}
                            onClick={() => !isFullyPaid() && onAddPayment(work)}
                            disabled={isFullyPaid()}
                            title={isFullyPaid() ? "No balance remaining" : "Add payment for this work"}
                        >
                            <i className="fas fa-dollar-sign"></i>
                            <span>Add Payment</span>
                        </button>
                        <button
                            type="button"
                            className="btn btn-card-secondary btn-print-receipt"
                            onClick={() => onPrintReceipt(work)}
                            title="Print today's receipt"
                        >
                            <i className="fas fa-print"></i>
                            <span>Print Receipt</span>
                        </button>
                        {isAlignerWork(work) && (
                            <button
                                type="button"
                                className="btn btn-card-secondary btn-add-set"
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
