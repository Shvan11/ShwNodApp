import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import cn from 'classnames';
import { isOrthoWork, needsDetails } from '../../config/workTypeConfig';
import { useConfirm } from '../../contexts/ConfirmContext';
import { workBalance } from '../../utils/workBalance';
import { useToday } from '../../hooks/useClock';
import { useMenuFocus, handleMenuKeyDown } from '../../hooks/useFloatingMenu';
import { isClinicDoctorName } from '@shared/clinic-doctor';
import { ALIGNER_SET_WORK_TYPE_IDS, WORK_STATUS } from '@shared/treatment-taxonomy';
import type { WorkRow } from '@shared/contracts/work.contract';
import WorkDetailsPanel from './WorkDetailsPanel';
import styles from './WorkCard.module.css';

/** One row of the works read (`GET /api/getworks`), exactly as the contract parses it. */
export type Work = WorkRow;

interface WorkCardProps {
    work: Work;
    personId?: number | null;
    isExpanded: boolean;
    /** Transfer to another patient — admin-only on the server. Pass `caps.adminWrites`. */
    canTransfer?: boolean;
    /**
     * Edit / Mark complete / Mark discontinued / Reactivate / Delete — `authorize(FINANCE_ROLES)`
     * on the server, so a clinical user must not be offered them (FE-F7-7). Pass
     * `caps.editRecords`; fail-closed like `writeFinance`.
     */
    editRecords?: boolean;
    /**
     * Money mutations (Add Payment) hide when false — clinical role sees finance read-only.
     * Defaults to false (fail-closed): a caller must opt in by passing `caps.writeFinance`,
     * so a new render site that forgets the prop never silently re-exposes the trigger.
     */
    writeFinance?: boolean;
    onToggleExpanded: () => void;
    onEdit: (work: Work) => void;
    /** Opens the work's keywords dialog. Same gate as Edit (`editRecords`): it is a work update. */
    onEditKeywords?: (work: Work) => void;
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
    formatDate: (date: string | null) => string;
    formatCurrency: (amount: number | null, currency: string | null) => string;
}

/** Room the ⋮ menu keeps from the window's bottom edge before it opens upward instead. */
const MENU_EDGE_PX = 8;

/** Months of elapsed treatment against which an ortho work with no estimate is measured. */
const TYPICAL_ORTHO_MONTHS = 18;

/**
 * Estimated progress of an ORTHO work: elapsed time since its start against its
 * estimated duration (or a typical course), clamped to 5–95 % while active so the
 * bar always moves and never implies completion before the work is finished. Other
 * work types get no bar at all — a filling added today used to read 5 % of an
 * 18-month course (audit FE-F7-16).
 *
 * `today` ('YYYY-MM-DD') is passed in, not read here: compiled, a clock read
 * inside this call would be cached on `work` and the bar would stop moving
 * (FE-F26-2). Both dates parse the same way, so the difference is whole days.
 */
function progressPercentage(work: Work, today: string): number {
    if (work.status === WORK_STATUS.FINISHED) return 100;
    if (work.status === WORK_STATUS.DISCONTINUED) return 0;
    if (!work.start_date) return 0;
    const start = new Date(work.start_date).getTime();
    if (Number.isNaN(start)) return 0;
    const months = work.estimated_duration != null && work.estimated_duration > 0
        ? work.estimated_duration
        : TYPICAL_ORTHO_MONTHS;
    const totalMs = months * 30 * 24 * 60 * 60 * 1000;
    const pct = Math.round(((new Date(today).getTime() - start) / totalMs) * 100);
    return Math.min(95, Math.max(5, pct));
}

const WorkCard = ({
    work,
    personId,
    isExpanded,
    canTransfer = false,
    editRecords = false,
    writeFinance = false,
    onToggleExpanded,
    onEdit,
    onEditKeywords,
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
}: WorkCardProps) => {
    const navigate = useNavigate();
    const { t } = useTranslation('works');
    const { t: tc } = useTranslation('common');
    const confirm = useConfirm();
    const today = useToday();
    const menuId = useId();
    const [showActions, setShowActions] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuButtonRef = useRef<HTMLButtonElement | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    // Treatment-item editors inside this card that hold unsaved input. Collapsing the
    // card unmounts them, so a collapse with any open asks first (audit FE-F7-14).
    const dirtyItemsRef = useRef<Set<string>>(new Set());
    const handleItemDirtyChange = (key: string, dirty: boolean) => {
        if (dirty) dirtyItemsRef.current.add(key);
        else dirtyItemsRef.current.delete(key);
    };

    const toggleExpanded = async () => {
        if (isExpanded && dirtyItemsRef.current.size > 0) {
            const discard = await confirm(tc('unsaved.message'), {
                title: tc('unsaved.title'),
                confirmText: tc('unsaved.discard'),
                cancelText: tc('unsaved.keepEditing'),
                danger: true,
            });
            if (!discard) return;
            dirtyItemsRef.current.clear();
        }
        onToggleExpanded();
    };

    // The ⋮ menu closes when its card expands or collapses (FE-F7-16). Keyed on the
    // change, not on "collapsed": the menu is offered on a collapsed card too.
    const [menuExpandedState, setMenuExpandedState] = useState(isExpanded);
    if (isExpanded !== menuExpandedState) {
        setMenuExpandedState(isExpanded);
        if (showActions) setShowActions(false);
    }

    // Outside click and Escape close the menu; Escape hands focus back to its button.
    useEffect(() => {
        if (!showActions) return;
        const onDown = (e: globalThis.MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setShowActions(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setShowActions(false);
            menuButtonRef.current?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [showActions]);

    // Focus into the open menu and back to the ⋮ button on close; arrows move
    // between items (the menu took Tab only, which a `role="menu"` doesn't promise).
    useMenuFocus(dropdownRef, showActions);

    // The menu opens upward when the window has no room for it below the ⋮ and more
    // above: a collapsed card near the bottom of the screen would otherwise hang its
    // last items off-screen. Measured before paint, so it never shows in the wrong place.
    const [dropUp, setDropUp] = useState(false);
    useLayoutEffect(() => {
        const menu = dropdownRef.current;
        const button = menuButtonRef.current;
        if (!showActions || !menu || !button) return;
        const anchor = button.getBoundingClientRect();
        const spaceBelow = window.innerHeight - anchor.bottom;
        setDropUp(spaceBelow < menu.offsetHeight + MENU_EDGE_PX && anchor.top > spaceBelow);
    }, [showActions]);

    const getStatusBadge = () => {
        if (work.status === WORK_STATUS.FINISHED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeCompleted)}>{t('card.statusCompleted')}</span>;
        }
        if (work.status === WORK_STATUS.DISCONTINUED) {
            return <span className={cn(styles.statusBadge, styles.statusBadgeDiscontinued)}>{t('card.statusDiscontinued')}</span>;
        }
        return <span className={cn(styles.statusBadge, styles.statusBadgeActive)}>{t('card.statusActive')}</span>;
    };

    const isActive = work.status === WORK_STATUS.ACTIVE;
    const isFinished = work.status === WORK_STATUS.FINISHED;
    const isDiscontinued = work.status === WORK_STATUS.DISCONTINUED;
    const typeOfWork = work.type_of_work ?? 0;
    const isOrtho = isOrthoWork(typeOfWork);
    const canAddAlignerSet = ALIGNER_SET_WORK_TYPE_IDS.includes(typeOfWork);
    const balance = workBalance(work);
    const progress = progressPercentage(work, today);
    const hasDuration = work.estimated_duration != null && work.estimated_duration > 0;
    // Keyword names as the works read joined them, in column order.
    const keywordNames = [work.Keyword1, work.Keyword2, work.Keyword3, work.Keyword4, work.Keyword5]
        .filter((name): name is string => !!name);

    // The Clinic pseudo-doctor is a bucket, not a person: "Clinic", not "Dr. Clinic".
    const doctorLabel = !work.doctor_name
        ? t('card.notAssigned')
        : isClinicDoctorName(work.doctor_name)
            ? t('card.clinicDoctor')
            : t('card.drPrefix', { name: work.doctor_name });

    const getCardClass = (): string => {
        if (isDiscontinued) return styles.discontinued;
        if (isFinished) return styles.completed;
        return styles.active;
    };

    // Every entry is a record write (editRecords) or Transfer (canTransfer), so the ⋮
    // shows only when it would hold something.
    const hasMenu = editRecords || (canTransfer && !!onTransfer);

    const runMenuAction = (action: (work: Work) => void) => {
        setShowActions(false);
        action(work);
    };

    return (
        <div
            className={cn(
                styles.card,
                getCardClass(),
                isExpanded ? styles.expanded : styles.collapsed,
                hasMenu && styles.hasActions,
                showActions && styles.menuOpen,
            )}
        >
            {/* Minimal Header - Always Visible */}
            <div
                className={styles.collapsedHeader}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => void toggleExpanded()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggleExpanded(); } }}
            >
                <div className={styles.titleSection}>
                    <div className={styles.title}>
                        <i
                            className={cn('fas', isExpanded ? 'fa-chevron-down' : 'fa-chevron-right', styles.chevronIcon, !isExpanded && styles.chevronCollapsed)}
                            aria-hidden="true"
                        ></i>
                        <i className="fas fa-tooth" aria-hidden="true"></i>
                        <h3>{work.type_name || t('card.otherTreatment')}</h3>
                        {getStatusBadge()}
                    </div>
                    <div className={styles.metaMinimal}>
                        <span><i className="fas fa-user-md" aria-hidden="true"></i> {doctorLabel}</span>
                        <span><i className="fas fa-calendar-plus" aria-hidden="true"></i> {formatDate(work.addition_date)}</span>
                        {!isExpanded && balance.remaining > 0 && (
                            <span className={styles.balanceIndicator}>
                                <i className="fas fa-exclamation-circle" aria-hidden="true"></i> {t('card.balance', { amount: formatCurrency(balance.remaining, work.currency) })}
                            </span>
                        )}
                        {/* Collapsed: the keywords share this line as one pill, cut with "…" when
                            long (all of them on hover), so a card with keywords is no taller than
                            one without — a patient's cards line up. */}
                        {!isExpanded && keywordNames.length > 0 && (
                            <span className={styles.keywordsInline} title={keywordNames.join(', ')}>
                                <i className="fas fa-tags" aria-hidden="true"></i>
                                <span className={styles.keywordsInlineText}>{keywordNames.join(', ')}</span>
                            </span>
                        )}
                    </div>
                    {/* Expanded: every keyword as its own tag. Plain spans, not a list: this
                        header is a `role="button"`, whose children are presentational, so the
                        names are read as its text. */}
                    {isExpanded && keywordNames.length > 0 && (
                        <div className={styles.keywords}>
                            {keywordNames.map((name, i) => (
                                // By position: a work may carry the same keyword twice.
                                <span key={i} className={styles.keyword}>
                                    <i className="fas fa-tag" aria-hidden="true"></i> {name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Actions Menu — on collapsed cards too, so Edit Keywords, Transfer and the
                status changes need no expand first. */}
            {hasMenu && (
                <div className={styles.actionsMenu} ref={menuRef}>
                    <button
                        type="button"
                        ref={menuButtonRef}
                        className="btn-icon"
                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            setShowActions(!showActions);
                        }}
                        title={t('card.moreActions')}
                        aria-label={t('card.moreActions')}
                        aria-haspopup="menu"
                        aria-expanded={showActions}
                        aria-controls={showActions ? menuId : undefined}
                    >
                        <i className="fas fa-ellipsis-v" aria-hidden="true"></i>
                    </button>
                    {showActions && (
                        <div
                            className={cn(styles.dropdown, dropUp && styles.dropUp)}
                            id={menuId}
                            ref={dropdownRef}
                            role="menu"
                            tabIndex={-1}
                            aria-label={t('card.moreActions')}
                            onKeyDown={(e) => handleMenuKeyDown(e, dropdownRef.current, () => setShowActions(false))}
                        >
                            {editRecords && (
                                <button type="button" role="menuitem" onClick={() => runMenuAction(onEdit)}>
                                    <i className="fas fa-edit" aria-hidden="true"></i> {t('card.editWork')}
                                </button>
                            )}
                            {editRecords && onEditKeywords && (
                                <button type="button" role="menuitem" onClick={() => runMenuAction(onEditKeywords)}>
                                    <i className="fas fa-tags" aria-hidden="true"></i> {t('card.editKeywords')}
                                </button>
                            )}
                            {canTransfer && onTransfer && (
                                <button type="button" role="menuitem" onClick={() => runMenuAction(onTransfer)}>
                                    <i className="fas fa-exchange-alt" aria-hidden="true"></i> {t('card.transferWork')}
                                </button>
                            )}
                            {editRecords && isActive && (
                                <>
                                    <button type="button" role="menuitem" onClick={() => runMenuAction(onComplete)}>
                                        <i className="fas fa-check-circle" aria-hidden="true"></i> {t('card.markComplete')}
                                    </button>
                                    <button type="button" role="menuitem" onClick={() => runMenuAction(onDiscontinue)}>
                                        <i className="fas fa-ban" aria-hidden="true"></i> {t('card.markDiscontinued')}
                                    </button>
                                </>
                            )}
                            {editRecords && (isFinished || isDiscontinued) && (
                                <button type="button" role="menuitem" onClick={() => runMenuAction(onReactivate)}>
                                    <i className="fas fa-redo" aria-hidden="true"></i> {t('card.reactivate')}
                                </button>
                            )}
                            {editRecords && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={styles.dropdownDeleteBtn}
                                    onClick={() => runMenuAction(onDelete)}
                                >
                                    <i className="fas fa-trash-alt" aria-hidden="true"></i> {t('card.deleteWork')}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Full Content - Only Visible When Expanded */}
            {isExpanded && (
                <div className={styles.fullContent}>
                    {/* Progress Section — an elapsed-time estimate, meaningful for ortho only */}
                    {isOrtho && (
                        <div className={styles.progress}>
                            <div className={styles.progressInfo}>
                                <span className={styles.progressLabel}>{t('card.treatmentProgress')}</span>
                                <span className={styles.progressPercentage}>{progress}%</span>
                            </div>
                            <div className={styles.progressBarContainer}>
                                <div
                                    className={styles.progressBarFill}
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Financial Summary */}
                    <div className={styles.financial}>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>{t('card.totalCost')}</span>
                            <span className={styles.financialValue}>{formatCurrency(work.total_required, work.currency)}</span>
                        </div>
                        {balance.discount > 0 && (
                            <>
                                <div className={styles.financialItem}>
                                    <span className={styles.financialLabel}>{t('card.discount')}</span>
                                    <span className={cn(styles.financialValue, styles.financialValueDiscount)}>
                                        -{formatCurrency(balance.discount, work.currency)}
                                    </span>
                                </div>
                                <div className={styles.financialItem}>
                                    <span className={styles.financialLabel}>{t('card.net')}</span>
                                    <span className={cn(styles.financialValue, styles.financialValueNet)}>
                                        {formatCurrency(balance.net, work.currency)}
                                    </span>
                                </div>
                            </>
                        )}
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>{t('card.paid')}</span>
                            <span className={cn(styles.financialValue, styles.financialValuePaid)}>{formatCurrency(work.TotalPaid, work.currency)}</span>
                        </div>
                        <div className={styles.financialItem}>
                            <span className={styles.financialLabel}>{t('card.remaining')}</span>
                            <span className={cn(styles.financialValue, balance.fullyPaid ? styles.financialValuePaidFull : styles.financialValueRemaining)}>
                                {formatCurrency(balance.remaining, work.currency)}
                            </span>
                        </div>
                    </div>

                    {/* Discount badge with date and optional reason */}
                    {balance.discount > 0 && (
                        <div className={cn(styles.infoItem, styles.discountBadge)}>
                            <i className="fas fa-tag" aria-hidden="true"></i>
                            <span>
                                {t('card.discountApplied')}
                                {work.discount_date ? t('card.discountOnDate', { date: formatDate(work.discount_date) }) : ''}
                                {work.discount_reason ? t('card.discountReason', { reason: work.discount_reason }) : ''}
                            </span>
                        </div>
                    )}

                    {/* Additional Details. A 0 duration is "not set" — `{0 && …}` used to
                        render a bare `0` here (FE-F7-9). */}
                    {(work.notes || hasDuration || work.debond_date || work.start_date) && (
                        <div className={styles.additionalInfo}>
                            {work.start_date && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-play-circle" aria-hidden="true"></i>
                                    <span>{t('card.started', { date: formatDate(work.start_date) })}</span>
                                </div>
                            )}
                            {hasDuration && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-clock" aria-hidden="true"></i>
                                    <span>{t('card.duration', { months: work.estimated_duration })}</span>
                                </div>
                            )}
                            {work.debond_date && (
                                <div className={styles.infoItem}>
                                    <i className="fas fa-calendar-check" aria-hidden="true"></i>
                                    <span>{t('card.debond', { date: formatDate(work.debond_date) })}</span>
                                </div>
                            )}
                            {work.notes && (
                                <div className={cn(styles.infoItem, styles.infoItemFullWidth)}>
                                    <i className="fas fa-sticky-note" aria-hidden="true"></i>
                                    <span>{work.notes}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Treatment items — self-contained inline panel for non-ortho works that track procedure rows */}
                    {needsDetails(typeOfWork) && (
                        <WorkDetailsPanel
                            workId={work.work_id}
                            typeOfWork={typeOfWork}
                            onItemDirtyChange={handleItemDirtyChange}
                        />
                    )}

                    {/* Primary Actions - Conditionally show based on work type */}
                    <div className={styles.primaryActions}>
                        {/* Visits & Diagnosis only for ortho-related works */}
                        {isOrtho && (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-new-visit"
                                    onClick={() => onNewVisit(work)}
                                    title={t('card.newVisitTitle')}
                                >
                                    <i className="fas fa-plus-circle" aria-hidden="true"></i>
                                    <span>{t('card.newVisit')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-visits"
                                    onClick={() => onViewVisits(work)}
                                    title={t('card.visitsTitle')}
                                >
                                    <i className="fas fa-calendar-check" aria-hidden="true"></i>
                                    <span>{t('card.visits')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-card-action btn-diagnosis"
                                    onClick={() => navigate(`/patient/${personId}/work/${work.work_id}/diagnosis`)}
                                    title={t('card.diagnosisTitle')}
                                >
                                    <i className="fas fa-stethoscope" aria-hidden="true"></i>
                                    <span>{t('card.diagnosis')}</span>
                                </button>
                            </>
                        )}

                        {/* Payments - always visible */}
                        <button
                            type="button"
                            className="btn btn-card-action btn-payments"
                            onClick={() => onViewPaymentHistory(work)}
                            title={t('card.paymentsTitle')}
                        >
                            <i className="fas fa-history" aria-hidden="true"></i>
                            <span>{t('card.payments')}</span>
                        </button>

                    </div>

                    {/* Secondary Actions */}
                    <div className={styles.secondaryActions}>
                        {writeFinance && (
                            <button
                                type="button"
                                className={cn('btn btn-card-secondary btn-add-payment', balance.fullyPaid && 'disabled')}
                                onClick={() => !balance.fullyPaid && onAddPayment(work)}
                                disabled={balance.fullyPaid}
                                title={balance.fullyPaid ? t('card.addPaymentNoBalance') : t('card.addPaymentTitle')}
                            >
                                <i className="fas fa-dollar-sign" aria-hidden="true"></i>
                                <span>{t('card.addPayment')}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn-card-secondary btn-print-receipt"
                            onClick={() => onPrintReceipt(work)}
                            title={t('card.printReceiptTitle')}
                        >
                            <i className="fas fa-print" aria-hidden="true"></i>
                            <span>{t('card.printReceipt')}</span>
                        </button>
                        {canAddAlignerSet && (
                            <button
                                type="button"
                                className="btn btn-card-secondary btn-add-set"
                                onClick={() => onAddAlignerSet(work)}
                                title={t('card.addAlignerSetTitle')}
                            >
                                <i className="fas fa-tooth" aria-hidden="true"></i>
                                <span>{t('card.addAlignerSet')}</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkCard;
