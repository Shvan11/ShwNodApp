import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import cn from 'classnames';
import { isOrthoWork, needsDetails } from '../../config/workTypeConfig';
import WorkDetailsPanel from './WorkDetailsPanel';
import styles from './WorkCard.module.css';

export interface Work {
    work_id: number;
    person_id: number;
    type_of_work: number;
    type_name?: string;
    status: number;
    status_name?: string;
    total_required?: number;
    TotalPaid?: number;
    currency?: 'USD' | 'IQD';
    addition_date?: string;
    start_date?: string;
    debond_date?: string;
    estimated_duration?: number;
    dr_id?: number;
    doctor_name?: string;
    notes?: string;
    keyword_id_1?: number;
    keyword_id_2?: number;
    keyword_id_3?: number;
    keyword_id_4?: number;
    keyword_id_5?: number;
    discount?: number | null;
    discount_date?: string | null;
    discount_reason?: string | null;
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
    isAdmin?: boolean;
    onToggleExpanded: () => void;
    onEdit: (work: Work) => void;
    onDelete: (work: Work) => void;
    onTransfer?: (work: Work) => void;
    onAddPayment: (work: Work) => void;
    onViewPaymentHistory: (work: Work) => void;
    onAddAlignerSet: (work: Work) => void;
    onComplete: (work: Work) => void;
    onDiscontinue: (work: Work) => void;
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
    isAdmin = false,
    onToggleExpanded,
    onEdit,
    onDelete,
    onTransfer,
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
        if (work.status === WORK_STATUS.FINISHED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeCompleted)}>Completed</span>;
        }
        if (work.status === WORK_STATUS.DISCONTINUED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeDiscontinued)}>Discontinued</span>;
        }
        return <span className={cn(styles.statusBadge, styles.statusBadgeActive)}>Active</span>;
    };

    const isActive = work.status === WORK_STATUS.ACTIVE;
    const isFinished = work.status === WORK_STATUS.FINISHED;
    const isDiscontinued = work.status === WORK_STATUS.DISCONTINUED;

    const getDiscount = (): number => Number(work.discount ?? 0);

    const getRemainingBalance = (): number => {
        return (work.total_required || 0) - getDiscount() - (work.TotalPaid || 0);
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
            <div className={styles.collapsedHeader} role="button" tabIndex={0} onClick={onToggleExpanded} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpanded(); } }}>
                <div className={styles.titleSection}>
                    <div className={styles.title}>
                        <i className={cn('fas', isExpanded ? 'fa-chevron-down' : 'fa-chevron-right', styles.chevronIcon)}></i>
                        <i className="fas fa-tooth"></i>
                        <h3>{work.type_name || 'Other Treatment'}</h3>
                        {getStatusBadge()}
                    </div>
                    <div className={styles.metaMinimal}>
                        <span><i className="fas fa-user-md"></i> {work.doctor_name ? (work.doctor_name === 'Admin' ? work.doctor_name : `Dr. ${work.doctor_name}`) : 'Not assigned'}</span>
                        <span><i className="fas fa-calendar-plus"></i> {formatDate(work.addition_date)}</span>
                        {!isExpanded && getRemainingBalance() > 0 && (
                            <span className={styles.balanceIndicator}>
                                <i className="fas fa-exclamation-circle"></i> Balance: {formatCurrency(getRemainingBalance(), work.currency)}
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
                            {isAdmin && onTransfer && (
                                <button type="button" onClick={() => { onTransfer(work); setShowActions(false); }}>
                                    <i className="fas fa-exchange-alt"></i> Transfer Work
                                </button>
                            )}
                            {isActive && (
                                <>
                                    <button type="button" onClick={() => { onComplete(work); setShowActions(false); }}>
                                        <i className="fas fa-check-circle"></i> Mark Complete
                                    </button>
                                    <button type="button" onClick={() => { onDiscontinue(work); setShowActions(false); }}>
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
                            <span className={styles.financialValue}>{formatCurrency(work.total_required, work.currency)}</span>
                        </div>
                        {getDiscount() > 0 && (
                            <>
                                <div className={styles.financialItem}>
                                    <span className={styles.financialLabel}>Discount</span>
                                    <span className={cn(styles.financialValue, styles.financialValueDiscount)}>
                                        -{formatCurrency(getDiscount(), work.currency)}
                                    </span>
                                </div>
                                <div className={styles.financialItem}>
                                    <span className={styles.financialLabel}>Net</span>
                                    <span className={cn(styles.financialValue, styles.financialValueNet)}>
                                        {formatCurrency((work.total_required || 0) - getDiscount(), work.currency)}
                                    </span>
                                </div>
                            </>
                        )}
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>Paid</span>
                            <span className={cn(styles.financialValue, styles.financialValuePaid)}>{formatCurrency(work.TotalPaid, work.currency)}</span>
                        </div>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>Remaining</span>
                            <span className={cn(styles.financialValue, isFullyPaid() ? styles.financialValuePaidFull : styles.financialValueRemaining)}>
                                {formatCurrency(getRemainingBalance(), work.currency)}
                            </span>
                        </div>
                    </div>

                    {/* Discount badge with date and optional reason */}
                    {getDiscount() > 0 && (
                        <div className={cn(styles.infoItem, styles.discountBadge)}>
                            <i className="fas fa-tag"></i>
                            <span>
                                Discount applied{work.discount_date ? ` on ${formatDate(work.discount_date)}` : ''}
                                {work.discount_reason ? ` — ${work.discount_reason}` : ''}
                            </span>
                        </div>
                    )}

                    {/* Additional Details */}
                    {(work.notes || work.estimated_duration || work.debond_date || work.start_date) && (
                        <div className={styles.additionalInfo}>
                            {work.start_date && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-play-circle"></i>
                                    <span>Started: {formatDate(work.start_date)}</span>
                                </div>
                            )}
                            {work.estimated_duration && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-clock"></i>
                                    <span>Duration: {work.estimated_duration} months</span>
                                </div>
                            )}
                            {work.debond_date && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-calendar-check"></i>
                                    <span>Debond: {formatDate(work.debond_date)}</span>
                                </div>
                            )}
                            {work.notes && (
                                <div className={cn(styles.infoItem, styles.infoItemFullWidth)}>
                                    <i className="fas fa-sticky-note"></i>
                                    <span>{work.notes}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Treatment items — self-contained inline panel for non-ortho works that track procedure rows */}
                    {needsDetails(work.type_of_work) && (
                        <WorkDetailsPanel
                            workId={work.work_id}
                            typeOfWork={work.type_of_work}
                        />
                    )}

                    {/* Primary Actions - Conditionally show based on work type */}
                    <div className={styles.primaryActions}>
                        {/* Visits & Diagnosis only for ortho-related works */}
                        {isOrthoWork(work.type_of_work) && (
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
                                    onClick={() => navigate(`/patient/${personId}/work/${work.work_id}/diagnosis`)}
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
