import React, { useState, useMemo, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import WorkCard, { type Work } from './WorkCard';
import PaymentModal from './PaymentModal';
import TransferWorkModal from './TransferWorkModal';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { formatCurrency as formatCurrencyUtil } from '../../utils/formatters';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import { parseLocalDate } from '../../utils/calendarDate';
import { workBalance } from '../../utils/workBalance';
import { LANGUAGES } from '../../core/language';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { WORK_STATUS } from '@shared/treatment-taxonomy';
import { postJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { invalidateAligner } from '@/query/aligner';
import { qk } from '@/query/keys';
import { invalidateApprovals } from '@/services/approvals';
import {
    worksQuery,
    patientInfoQuery,
    hasAppointmentQuery,
    paymentHistoryQuery,
    galleryQuery,
} from '@/query/queries';
import { buildWorkingContentUrl } from './files/fileHelpers';
import { deleteInvoice as deleteInvoiceContract } from '@shared/contracts/payment.contract';
import { deleteWork as deleteWorkContract } from '@shared/contracts/work.contract';
import * as appointmentContract from '@shared/contracts/appointment.contract';
import styles from './WorkComponent.module.css';

/** Blocking-record counts carried on a work-delete 409 (`details.dependencies`). */
interface WorkDeleteDependencies {
    InvoiceCount?: number;
    VisitCount?: number;
    ItemCount?: number;
    DiagnosisCount?: number;
    ImplantCount?: number;
    ScrewCount?: number;
    AlignerSetCount?: number;
}

interface WorkComponentProps {
    personId?: number | null;
}

type FilterStatus = 'all' | 'active' | 'completed' | 'discontinued';

// Filter <option> values are programmatic tokens, kept here as expressions so the
// i18next ratchet's `value`-attr check doesn't flag them as literals; only the
// labels are translated (via labelKey) at render time. `as const` narrows labelKey
// to literal keys so the typed t() accepts them.
const FILTER_OPTIONS = [
    { value: 'all', labelKey: 'filter.all' },
    { value: 'active', labelKey: 'filter.active' },
    { value: 'completed', labelKey: 'filter.completed' },
    { value: 'discontinued', labelKey: 'filter.discontinued' },
] as const;

/**
 * Work Component
 * Displays list of patient's treatment works
 * Memoized to prevent unnecessary re-renders when personId hasn't changed
 */
const WorkComponent = ({ personId }: WorkComponentProps) => {
    const navigate = useNavigate();
    const { t } = useTranslation('works');
    const { language } = useLanguage();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const user = useAuthUser();
    // Clinical staff see payments/receipts read-only — money mutations stay
    // hidden (Add Payment, payment delete), reads/printing stay visible (history,
    // receipt). Work edit/lifecycle/delete is `editRecords`, Transfer `adminWrites`
    // — each mirrors the server gate on its route, so no button leads to a 403
    // (FE-F7-7).
    const caps = roleCaps(user?.role as UserRole | undefined);
    // Works list read. On useQuery so a work mutation's invalidateQueries(qk.patient.all)
    // refreshes it live. The rows are the contract's `WorkRow`, used as parsed — the card
    // reads the same type (a curated `Work` used to be bridged in with a cast: FE-F7-17).
    const { data: worksData, isLoading: loading } = useQuery({
        ...worksQuery(personId ?? ''),
        enabled: !!personId,
    });
    const works = useMemo(() => worksData ?? [], [worksData]);

    // Patient demographics, appointment flag, and the two form lookups — all on
    // useQuery so they share the cache (patient info is deduped across screens)
    // and a patient-scoped invalidation refreshes them live.
    // Read as the contract parses it. The card used to read `Phone` and `activeAlert`
    // through a cast — fields the row does not have (`phone`; `activeAlert` was retired
    // with patients.alerts), so the phone and the alert badge never rendered (FE-F7-10).
    const { data: patientInfoData } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: !!personId,
    });
    const patientInfo = patientInfoData ?? null;

    const { data: appointmentData, isLoading: loadingAppointment } = useQuery({
        ...hasAppointmentQuery(personId ?? ''),
        enabled: !!personId,
    });
    const hasNextAppointment = appointmentData?.hasAppointment ?? false;

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
    const [patientPhotoError, setPatientPhotoError] = useState(false);
    // The card's photo is the first session's Smile, from the gallery read (shared
    // with the photo grid): the file that is on disk (either case) and its mtime as
    // the version, served as the small thumbnail. It used to be `/DolImgs/{id}00.i13`
    // — the full render, lower case only, with no version, so a re-crop stayed stale
    // behind the immutable cache header (FE-F13-1's sibling).
    const { data: initialGallery } = useQuery({
        ...galleryQuery(personId ?? '', 0),
        enabled: !!personId,
    });
    const smile = initialGallery?.i13 ?? null;

    // Payment-related state. PaymentModal is a form seeded once from the row it opens
    // with, so it keeps that row; the history box shows the LIVE row (below).
    const [paymentWork, setPaymentWork] = useState<Work | null>(null);
    // The payment-history box reads the work from the live works list by id. It used
    // to read a click-time snapshot, so after a payment delete it kept the old totals,
    // and it left the discount out of the balance — "Balance Remaining 50,000" and an
    // "Add New Payment" on a work its own card showed as paid (FE-F7-6).
    const [historyWorkId, setHistoryWorkId] = useState<number | null>(null);
    const historyWork = historyWorkId == null ? null : works.find(w => w.work_id === historyWorkId) ?? null;
    const historyBalance = historyWork ? workBalance(historyWork) : null;

    // Payment history read on useQuery, gated to its open modal + selected work.
    // (Work-detail rows now load inside each WorkCard's inline WorkDetailsPanel.)
    const { data: paymentHistoryData, isLoading: loadingPayments } = useQuery({
        ...paymentHistoryQuery(historyWorkId ?? 0),
        enabled: historyWorkId != null,
    });
    const paymentHistory = paymentHistoryData ?? [];

    // Check-in state
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkedIn, setCheckedIn] = useState(false);

    // Expanded works state - track which work IDs are expanded
    const [expandedWorks, setExpandedWorks] = useState<Set<number>>(new Set());

    // Delete confirmation modal state
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [workToDelete, setWorkToDelete] = useState<Work | null>(null);

    // Generic confirmation modal state
    const [confirmationModal, setConfirmationModal] = useState<{
        show: boolean;
        type: 'complete' | 'discontinue' | 'reactivate' | null;
        work: Work | null;
    }>({ show: false, type: null, work: null });

    // Transfer work modal state (admin only)
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [workToTransfer, setWorkToTransfer] = useState<Work | null>(null);

    // Auto-expand the first active work once per patient, when their works first load.
    // Done during render (adjust-state-during-render) so the React Compiler can optimize
    // it. It used to key on the works-data identity, so every refetch that changed data
    // (a payment, a colleague's edit) collapsed the cards the user had opened — and
    // unmounted any treatment item they were typing into (FE-F7-14).
    const [autoExpandedFor, setAutoExpandedFor] = useState<number | null | undefined>(undefined);
    if (worksData != null && autoExpandedFor !== personId) {
        setAutoExpandedFor(personId);
        const firstActiveWork = works.find(work => work.status === WORK_STATUS.ACTIVE);
        setExpandedWorks(firstActiveWork ? new Set([firstActiveWork.work_id]) : new Set());
    }

    // A lifecycle write changes the patient's works list AND the work's own reads (the
    // shell's work header on the visits/diagnosis pages, the cached transfer preview),
    // which used to stay fresh-but-wrong for 30 s (FE-F7-8).
    const invalidateWorkWrite = (workId: number) => {
        void queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
        void queryClient.invalidateQueries({ queryKey: qk.work.all(workId) });
        // A work's status, owner or existence also decides which aligner sets the
        // aligner lists show (All Sets hides closed works) — FE-F7-8's hand-down to
        // F17, answered in FE-F17-6.
        void invalidateAligner();
    };

    const handlePrintNoWorkReceipt = () => {
        if (!hasNextAppointment) {
            toast.warning(t('printAppointment.toastNoAppt'));
            return;
        }

        // Open receipt in new window
        const receiptUrl = `/api/templates/receipt/no-work/${personId}?autoprint=1`;

        const receiptWindow = window.open(receiptUrl, '_blank');

        if (!receiptWindow) {
            toast.error(t('printAppointment.toastWindowFailed'));
        } else {
            toast.success(t('printAppointment.toastOpening'));
        }
    };

    const handleAddWork = () => {
        navigate(`/patient/${personId}/new-work`);
    };

    const handleEditWork = (work: Work) => {
        navigate(`/patient/${personId}/new-work?workId=${work.work_id}`);
    };

    // Show confirmation modal for work status changes
    const handleCompleteWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'complete', work });
    };

    const handleDiscontinueWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'discontinue', work });
    };

    const handleReactivateWork = (work: Work) => {
        setConfirmationModal({ show: true, type: 'reactivate', work });
    };

    const closeConfirmationModal = () => {
        setConfirmationModal({ show: false, type: null, work: null });
    };

    const executeConfirmedAction = async () => {
        const { type, work } = confirmationModal;
        if (!type || !work) return;

        closeConfirmationModal();

        try {
            let endpoint = '';
            let body: Record<string, unknown> = {};
            let successMessage = '';

            switch (type) {
                case 'complete':
                    endpoint = '/api/finishwork';
                    body = { workId: work.work_id };
                    successMessage = t('toast.completed');
                    break;
                case 'discontinue':
                    endpoint = '/api/discontinuework';
                    body = { workId: work.work_id };
                    successMessage = t('toast.discontinued');
                    break;
                case 'reactivate':
                    endpoint = '/api/reactivatework';
                    body = { workId: work.work_id, personId: work.person_id };
                    successMessage = t('toast.reactivated');
                    break;
            }

            await postJSON(endpoint, body);

            toast.success(successMessage);
            invalidateWorkWrite(work.work_id);
        } catch (err) {
            const failFallback = type === 'complete'
                ? t('toast.failComplete')
                : type === 'discontinue'
                    ? t('toast.failDiscontinue')
                    : t('toast.failReactivate');
            toast.error(httpErrorMessage(err, failFallback), 5000);
        }
    };

    // Get confirmation modal content based on type
    const getConfirmationModalContent = () => {
        const { type, work } = confirmationModal;
        if (!type || !work) return null;

        const configs = {
            complete: {
                title: t('statusModal.complete.title'),
                icon: 'fa-check-circle',
                tone: styles.confirmToneSuccess,
                message: t('statusModal.complete.message'),
                warning: t('statusModal.complete.warning'),
                buttonText: t('statusModal.complete.button'),
                buttonIcon: 'fa-check'
            },
            discontinue: {
                title: t('statusModal.discontinue.title'),
                icon: 'fa-times-circle',
                tone: styles.confirmToneWarning,
                message: t('statusModal.discontinue.message'),
                warning: t('statusModal.discontinue.warning'),
                buttonText: t('statusModal.discontinue.button'),
                buttonIcon: 'fa-times'
            },
            reactivate: {
                title: t('statusModal.reactivate.title'),
                icon: 'fa-redo',
                tone: styles.confirmToneInfo,
                message: t('statusModal.reactivate.message'),
                warning: t('statusModal.reactivate.warning'),
                buttonText: t('statusModal.reactivate.button'),
                buttonIcon: 'fa-redo'
            }
        };

        return { ...configs[type], work };
    };

    const handleDeleteWork = (work: Work) => {
        setWorkToDelete(work);
        setShowDeleteConfirmation(true);
    };

    const confirmDeleteWork = async () => {
        if (!workToDelete) return;

        setShowDeleteConfirmation(false);

        try {
            const work = workToDelete;
            const deleteResult = await deleteJSON<{ outcome: string }>('/api/deletework', {
                body: JSON.stringify({ workId: work.work_id }),
                schema: deleteWorkContract.response,
            });

            if (deleteResult.outcome === 'pending') {
                toast.success(t('toast.submittedForApproval'));
                // A request was created but no row changed — tell the approval bells
                // (they only hear about a RESOLVED request otherwise, and poll every 5 min).
                void invalidateApprovals();
                return;
            }
            toast.success(t('toast.deleted'));
            void queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            void invalidateAligner();
            // The work is gone: drop its own reads rather than refetch them into a 404.
            queryClient.removeQueries({ queryKey: qk.work.all(work.work_id) });
        } catch (err) {
            // A 409 carries a `details.dependencies` breakdown of the blocking records.
            const httpErr = err as HttpError;
            const deps = (httpErr.data as { details?: { dependencies?: WorkDeleteDependencies } } | undefined)
                ?.details?.dependencies;
            if (httpErr.status === 409 && deps) {
                let detailMessage = `${t('deleteDeps.header')}\n\n`;
                detailMessage += `${t('deleteDeps.intro')}\n\n`;

                if (deps.InvoiceCount && deps.InvoiceCount > 0) detailMessage += `${t('deleteDeps.payments', { n: deps.InvoiceCount })}\n`;
                if (deps.VisitCount && deps.VisitCount > 0) detailMessage += `${t('deleteDeps.visits', { n: deps.VisitCount })}\n`;
                if (deps.ItemCount && deps.ItemCount > 0) detailMessage += `${t('deleteDeps.items', { n: deps.ItemCount })}\n`;
                if (deps.DiagnosisCount && deps.DiagnosisCount > 0) detailMessage += `${t('deleteDeps.diagnoses', { n: deps.DiagnosisCount })}\n`;
                if (deps.ImplantCount && deps.ImplantCount > 0) detailMessage += `${t('deleteDeps.implants', { n: deps.ImplantCount })}\n`;
                if (deps.ScrewCount && deps.ScrewCount > 0) detailMessage += `${t('deleteDeps.screws', { n: deps.ScrewCount })}\n`;
                if (deps.AlignerSetCount && deps.AlignerSetCount > 0) detailMessage += `${t('deleteDeps.alignerSets', { n: deps.AlignerSetCount })}\n`;

                detailMessage += `\n${t('deleteDeps.footer')}`;

                toast.error(detailMessage, 10000);
                return;
            }

            toast.error(httpErrorMessage(err, t('toast.failDelete')), 5000);
        } finally {
            setWorkToDelete(null);
        }
    };

    const cancelDeleteWork = () => {
        setShowDeleteConfirmation(false);
        setWorkToDelete(null);
    };

    // Transfer work handlers (admin only)
    const handleTransferWork = (work: Work) => {
        setWorkToTransfer(work);
        setShowTransferModal(true);
    };

    // The modal toasts nothing on success itself (it used to, so a transfer toasted twice).
    const handleTransferSuccess = (result: { workId: number; targetPatientId: number }) => {
        setShowTransferModal(false);
        setWorkToTransfer(null);
        // The work left this patient for another: refresh both patients and the work's
        // own reads — the target's list used to stay stale for 30 s (FE-F7-8).
        invalidateWorkWrite(result.workId);
        void queryClient.invalidateQueries({ queryKey: qk.patient.all(result.targetPatientId) });
        toast.success(t('toast.transferred'));
    };

    // The search box matches the work type as well as the notes and the doctor (FE-F7-16).
    const needle = searchTerm.trim().toLowerCase();
    const filteredWorks = works
        .filter(work => {
            const matchesSearch = !needle ||
                [work.type_name, work.notes, work.doctor_name].some(v => v?.toLowerCase().includes(needle));

            const matchesFilter = filterStatus === 'all' ||
                (filterStatus === 'active' && work.status === WORK_STATUS.ACTIVE) ||
                (filterStatus === 'completed' && work.status === WORK_STATUS.FINISHED) ||
                (filterStatus === 'discontinued' && work.status === WORK_STATUS.DISCONTINUED);

            return matchesSearch && matchesFilter;
        })
        .sort((a, b) => {
            if (a.status === WORK_STATUS.ACTIVE && b.status !== WORK_STATUS.ACTIVE) return -1;
            if (a.status !== WORK_STATUS.ACTIVE && b.status === WORK_STATUS.ACTIVE) return 1;
            if (a.status === WORK_STATUS.DISCONTINUED && b.status === WORK_STATUS.FINISHED) return -1;
            if (a.status === WORK_STATUS.FINISHED && b.status === WORK_STATUS.DISCONTINUED) return 1;

            const dateA = new Date(a.addition_date || 0);
            const dateB = new Date(b.addition_date || 0);
            return dateA.getTime() - dateB.getTime();
        });

    const formatCurrency = (amount: number | null, currency: string | null): string => {
        if (amount == null) return t('common.na');
        return formatCurrencyUtil(amount, currency || 'USD');
    };

    // In the app's language with Western digits — the browser's locale used to pick the
    // digits (FE-F3-3) — and a date-only string on its own calendar day.
    const formatDate = (dateString: string | null): string => {
        if (!dateString) return t('common.notSet');
        return parseLocalDate(dateString).toLocaleDateString(LANGUAGES[language].locale);
    };

    const handleAddAlignerSet = (work: Work) => {
        navigate(`/aligner/patient/${work.work_id}`);
    };

    const handleAddPayment = (work: Work) => {
        setPaymentWork(work);
    };

    const handleViewPaymentHistory = (work: Work) => {
        setHistoryWorkId(work.work_id);
        // The payment-history query (gated on the open modal's work) loads itself.
    };

    const handlePrintReceipt = (work: Work) => {
        window.open(`/api/templates/receipt/work/${work.work_id}?autoprint=1`, '_blank');
    };

    const toggleWorkExpanded = (workId: number) => {
        setExpandedWorks(prevExpanded => {
            const newExpanded = new Set(prevExpanded);
            if (newExpanded.has(workId)) {
                newExpanded.delete(workId);
            } else {
                newExpanded.add(workId);
            }
            return newExpanded;
        });
    };

    const handleQuickCheckin = async () => {
        try {
            setCheckingIn(true);
            const result = await postJSON<{ alreadyCheckedIn?: boolean; created?: boolean }>(
                '/api/appointments/quick-checkin',
                { person_id: personId },
                { schema: appointmentContract.quickCheckin.response }
            );

            const patientLabel = patientInfo?.patient_name || t('common.patient');
            if (result.alreadyCheckedIn) {
                toast.success(t('checkin.toastAlready', { name: patientLabel }));
                setCheckedIn(true);
            } else if (result.created) {
                toast.success(t('checkin.toastAdded', { name: patientLabel }));
                setCheckedIn(true);
            } else {
                toast.success(t('checkin.toastSuccess', { name: patientLabel }));
                setCheckedIn(true);
            }
            // Quick check-in CREATES a same-day appointment when none exists, so it
            // is an appointment write like any other: refresh the patient's
            // appointment-backed reads and the calendar/slot reads it just changed.
            queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            queryClient.invalidateQueries({ queryKey: qk.calendar.all() });
            // …and today's daily board, so a return to it shows the walk-in (FE-F11-17).
            queryClient.invalidateQueries({ queryKey: qk.appointments.all() });
        } catch (err) {
            toast.error(httpErrorMessage(err, t('checkin.toastFail')), 5000);
        } finally {
            setCheckingIn(false);
        }
    };

    if (loading) return <div className={styles.loading}>{t('loading.works')}</div>;

    return (
        <div className={styles.component}>
            {/* Patient Info Card with Controls */}
            {patientInfo && (
                <div className={styles.patientInfoCard}>
                    <div className={styles.patientPhotoContainer}>
                        {patientPhotoError || !smile || !personId ? (
                            <i className={`fas fa-user ${styles.patientPhotoFallback}`} aria-hidden="true"></i>
                        ) : (
                            <img
                                src={buildWorkingContentUrl(personId, smile.name, { thumb: 240, v: smile.mtime })}
                                alt={t('patientCard.smileAlt', { name: patientInfo.patient_name })}
                                className={styles.patientPhoto}
                                onError={() => setPatientPhotoError(true)}
                            />
                        )}
                    </div>
                    <div className={styles.patientInfoDetails}>
                        <div className={styles.patientInfoRow}>
                            <div className={styles.patientInfoHeader}>
                                <h3 className={styles.patientName}>
                                    {patientInfo.patient_name}
                                </h3>
                                <div className={styles.patientMetaInfo}>
                                    <span><i className="fas fa-id-card" aria-hidden="true"></i>{patientInfo.person_id}</span>
                                    {patientInfo.phone && (
                                        <span dir="ltr"><i className="fas fa-phone" aria-hidden="true"></i>{formatPhoneForDisplay(patientInfo.phone)}</span>
                                    )}
                                    {/* A 0 estimate is "none" — `{0 && …}` would render a bare 0 (FE-F7-9). */}
                                    {patientInfo.estimatedCost != null && patientInfo.estimatedCost > 0 && (
                                        <span className={styles.patientCostBadge}>
                                            <i className="fas fa-dollar-sign" aria-hidden="true"></i>
                                            {formatCurrencyUtil(patientInfo.estimatedCost, patientInfo.currency || 'IQD')}
                                        </span>
                                    )}
                                    {patientInfo.AlertCount > 0 && (
                                        <button
                                            type="button"
                                            className={`${styles.patientAlertBadge} ${styles.patientAlertBadgeSeverity2}`}
                                            onClick={() => navigate(`/patient/${patientInfo.person_id}/patient-info`)}
                                            title={t('patientCard.alertsTitle')}
                                        >
                                            <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                                            {t('patientCard.alerts', { n: patientInfo.AlertCount })}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className={styles.workSummaryInline}>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.length}</span>
                                    <span className={styles.summaryLabelInline}>{t('summary.total')}</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.ACTIVE).length}</span>
                                    <span className={styles.summaryLabelInline}>{t('summary.active')}</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.FINISHED).length}</span>
                                    <span className={styles.summaryLabelInline}>{t('summary.completed')}</span>
                                </div>
                                <div className={styles.summaryCardInline}>
                                    <span className={styles.summaryValueInline}>{works.filter(w => w.status === WORK_STATUS.DISCONTINUED).length}</span>
                                    <span className={styles.summaryLabelInline}>{t('summary.discontinued')}</span>
                                </div>
                            </div>
                        </div>
                        <div className={styles.patientControls}>
                            <input
                                type="text"
                                placeholder={t('controls.searchPlaceholder')}
                                aria-label={t('controls.searchPlaceholder')}
                                value={searchTerm}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                            <select
                                value={filterStatus}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as FilterStatus)}
                                className={styles.filterSelect}
                                aria-label={t('filter.label')}
                            >
                                {FILTER_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleQuickCheckin}
                                className={`btn btn-work-checkin ${checkedIn ? styles.checkedIn : ''} ${checkingIn ? styles.checkingIn : ''}`}
                                disabled={checkingIn || checkedIn}
                                title={checkedIn ? t('checkin.titleDone') : t('checkin.title')}
                            >
                                <i className="fas fa-user-check" aria-hidden="true"></i>
                                {checkingIn ? t('checkin.checkingIn') : checkedIn ? t('checkin.checkedIn') : t('checkin.checkIn')}
                            </button>
                            <button
                                onClick={handlePrintNoWorkReceipt}
                                className="btn btn-secondary"
                                disabled={loadingAppointment || !hasNextAppointment}
                                title={!hasNextAppointment ? t('printAppointment.noAppt') : t('printAppointment.title')}
                            >
                                <i className="fas fa-print" aria-hidden="true"></i>
                                {loadingAppointment ? t('printAppointment.loading') : t('printAppointment.label')}
                            </button>
                            <button onClick={handleAddWork} className="btn btn-primary">
                                <i className="fas fa-plus" aria-hidden="true"></i>
                                {t('controls.addWork')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Works Card Container */}
            <div className={styles.worksCardContainer}>
                {filteredWorks.map((work) => (
                    <WorkCard
                        key={work.work_id}
                        work={work}
                        personId={personId}
                        isExpanded={expandedWorks.has(work.work_id)}
                        canTransfer={caps.adminWrites}
                        editRecords={caps.editRecords}
                        writeFinance={caps.writeFinance}
                        onToggleExpanded={() => toggleWorkExpanded(work.work_id)}
                        onEdit={handleEditWork}
                        onDelete={handleDeleteWork}
                        onTransfer={handleTransferWork}
                        onAddPayment={handleAddPayment}
                        onViewPaymentHistory={handleViewPaymentHistory}
                        onAddAlignerSet={handleAddAlignerSet}
                        onComplete={handleCompleteWork}
                        onDiscontinue={handleDiscontinueWork}
                        onReactivate={handleReactivateWork}
                        onViewVisits={(work) => navigate(`/patient/${personId}/visits?workId=${work.work_id}`)}
                        onNewVisit={(work) => navigate(`/patient/${personId}/new-visit?workId=${work.work_id}`)}
                        onPrintReceipt={handlePrintReceipt}
                        formatDate={formatDate}
                        formatCurrency={formatCurrency}
                    />
                ))}
                {filteredWorks.length === 0 && (
                    <div className={styles.noWorksMessage}>
                        <i className={`fas fa-tooth ${styles.noWorksIcon}`} aria-hidden="true"></i>
                        <p className={styles.noWorksText}>
                            {searchTerm || filterStatus !== 'all'
                                ? t('empty.noMatch')
                                : t('empty.none')}
                        </p>
                    </div>
                )}
            </div>

            {/* Payment Modal */}
            {paymentWork && (
                <PaymentModal
                    workData={paymentWork}
                    onClose={() => {
                        setPaymentWork(null);
                        queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
                    }}
                    onSuccess={() => {
                        toast.success(t('toast.paymentAdded'));
                    }}
                />
            )}

            {/* Payment History Modal — the work row is the live one from the works list */}
            {historyWork && historyBalance && (
                <Modal
                    isOpen={true}
                    onClose={() => setHistoryWorkId(null)}
                    contentClassName={`${styles.modal} ${styles.detailsModal}`}
                    ariaLabelledBy="payment-history-title"
                >
                        <ModalHeader
                            title={t('paymentHistory.title', { name: historyWork.type_name || t('paymentHistory.workFallback', { id: historyWork.work_id }) })}
                            titleId="payment-history-title"
                            icon={<i className="fas fa-receipt" aria-hidden="true" />}
                            onClose={() => setHistoryWorkId(null)}
                        />
                        <div className={styles.modalContentScroll}>

                            <div className={styles.paymentSummaryBox}>
                                <div className={styles.paymentSummaryGrid}>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>{t('paymentHistory.totalRequired')}</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValueTotal}`}>
                                            {formatCurrency(historyWork.total_required, historyWork.currency)}
                                        </span>
                                    </div>
                                    {historyBalance.discount > 0 && (
                                        <div className={styles.paymentSummaryItem}>
                                            <span className={styles.paymentSummaryLabel}>{t('paymentHistory.discount')}</span>
                                            <span className={styles.paymentSummaryValue}>
                                                -{formatCurrency(historyBalance.discount, historyWork.currency)}
                                            </span>
                                        </div>
                                    )}
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>{t('paymentHistory.totalPaid')}</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValuePaid}`}>
                                            {formatCurrency(historyWork.TotalPaid, historyWork.currency)}
                                        </span>
                                    </div>
                                    <div className={styles.paymentSummaryItem}>
                                        <span className={styles.paymentSummaryLabel}>{t('paymentHistory.balanceRemaining')}</span>
                                        <span className={`${styles.paymentSummaryValue} ${styles.paymentSummaryValueBalance}`}>
                                            {formatCurrency(historyBalance.remaining, historyWork.currency)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {loadingPayments ? (
                                <div className={styles.loading}>
                                    {t('paymentHistory.loading')}
                                </div>
                            ) : (
                                <div className={styles.detailsTableContainer}>
                                    <table className={styles.detailsTable}>
                                        <thead>
                                            <tr>
                                                <th>{t('paymentHistory.table.date')}</th>
                                                <th>{t('paymentHistory.table.amountPaid', { currency: historyWork.currency })}</th>
                                                <th>{t('paymentHistory.table.change')}</th>
                                                {caps.writeFinance && <th>{t('paymentHistory.table.actions')}</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paymentHistory.map((payment) => (
                                                <tr key={payment.InvoiceID}>
                                                    {/* data-label feeds the ≤768px card layout's ::before row labels
                                                        (the table stacks instead of side-scrolling on a phone), so
                                                        these are visible text and stay translated. */}
                                                    <td data-label={t('paymentHistory.table.date')}>{formatDate(payment.date_of_payment)}</td>
                                                    <td data-label={t('paymentHistory.table.amountPaid', { currency: historyWork.currency })} className={styles.paymentAmount}>
                                                        {formatCurrency(payment.amount_paid, historyWork.currency)}
                                                    </td>
                                                    {/* Change is always handed back in IQD (the clinic's cash float),
                                                        whatever the work is denominated in. It used to be formatted
                                                        with the since-dropped `actual_cur`, which no write path
                                                        filled — so every change row was labelled 'USD' by the
                                                        fallback in the local formatCurrency wrapper. */}
                                                    <td data-label={t('paymentHistory.table.change')}>{payment.change ? formatCurrency(payment.change, 'IQD') : '-'}</td>
                                                    {caps.writeFinance && (
                                                        <td data-label={t('paymentHistory.table.actions')}>
                                                            <div className={styles.paymentActions}>
                                                                <button
                                                                    onClick={async () => {
                                                                        if (await confirm(t('paymentHistory.deleteConfirm', { amount: formatCurrency(payment.amount_paid, historyWork.currency), date: formatDate(payment.date_of_payment) }), { title: t('paymentHistory.deleteTitle'), danger: true, confirmText: t('paymentHistory.deleteConfirmButton') })) {
                                                                            try {
                                                                                const invResult = await deleteJSON<{ outcome: string }>(`/api/deleteInvoice/${payment.InvoiceID}`, {
                                                                                    schema: deleteInvoiceContract.response,
                                                                                });
                                                                                if (invResult.outcome === 'pending') {
                                                                                    toast.success(t('toast.submittedForApproval'));
                                                                                    // A request was created but no row changed — tell the approval bells
                                                                                    // (they only hear about a RESOLVED request otherwise, and poll every 5 min).
                                                                                    void invalidateApprovals();
                                                                                    return;
                                                                                }
                                                                                // qk.work.all covers the payment-history child key, so this
                                                                                // one invalidation refreshes the open modal's list too; the
                                                                                // patient key refreshes the works row the summary reads.
                                                                                invalidateWorkWrite(historyWork.work_id);
                                                                                toast.success(t('paymentHistory.deleteSuccess'));
                                                                            } catch (error) {
                                                                                toast.error(t('paymentHistory.deleteError', { error: httpErrorMessage(error, t('paymentHistory.unknownError')) }));
                                                                            }
                                                                        }
                                                                    }}
                                                                    className={styles.btnActionDelete}
                                                                    title={t('paymentHistory.deleteTitle')}
                                                                    aria-label={t('paymentHistory.deleteTitle')}
                                                                >
                                                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                            {paymentHistory.length === 0 && (
                                                <tr>
                                                    <td colSpan={caps.writeFinance ? 4 : 3} className={styles.noData}>
                                                        {t('paymentHistory.noPayments')}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className={styles.paymentHistoryFooter}>
                                {!historyBalance.fullyPaid ? (
                                    // Recording a payment is FINANCE_ROLES — a clinical user reads the
                                    // balance here but is not offered the write (FE-F7-7).
                                    caps.writeFinance && <button
                                        onClick={() => {
                                            setHistoryWorkId(null);
                                            handleAddPayment(historyWork);
                                        }}
                                        className={`btn btn-primary ${styles.addPaymentBtn}`}
                                    >
                                        <i className="fas fa-plus" aria-hidden="true"></i> {t('paymentHistory.addPayment')}
                                    </button>
                                ) : (
                                    <div className={styles.paymentFullyPaid}>
                                        <i className="fas fa-check-circle" aria-hidden="true"></i> {t('paymentHistory.fullyPaid')}
                                    </div>
                                )}
                            </div>
                        </div>
                </Modal>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirmation && workToDelete && (
                <Modal
                    isOpen={true}
                    onClose={cancelDeleteWork}
                    contentClassName={`whatsapp-modal ${styles.confirmDialog}`}
                    ariaLabelledBy="delete-work-title"
                >
                        <ModalHeader
                            title={t('deleteWork.title')}
                            titleId="delete-work-title"
                            icon={<i className="fas fa-exclamation-triangle" aria-hidden="true" />}
                            variant="danger"
                            onClose={cancelDeleteWork}
                        />
                        <div className={styles.confirmBody}>
                            <p className={styles.confirmIntro}>
                                {t('deleteWork.confirm')}
                            </p>
                            <div className={styles.confirmDetailsBox}>
                                <p className={styles.confirmDetailLine}>
                                    <strong>{t('common.workType')}:</strong> {workToDelete.type_name || t('common.na')}
                                </p>
                                <p className={styles.confirmDetailLine}>
                                    <strong>{t('common.doctor')}:</strong> {workToDelete.doctor_name || t('common.na')}
                                </p>
                                <p className={styles.confirmDetailLine}>
                                    <strong>{t('common.totalRequired')}:</strong> {formatCurrency(workToDelete.total_required, workToDelete.currency)}
                                </p>
                            </div>
                            <p className={`${styles.confirmWarning} ${styles.confirmWarningStrong}`}>
                                {t('deleteWork.cannotUndo')}
                            </p>
                        </div>
                        <div className="whatsapp-actions">
                            <button onClick={cancelDeleteWork} className="whatsapp-btn-cancel">
                                <i className="fas fa-times" aria-hidden="true"></i> {t('common.cancel')}
                            </button>
                            <button
                                onClick={confirmDeleteWork}
                                className={`whatsapp-btn-send ${styles.confirmActionButton}`}
                            >
                                <i className="fas fa-trash" aria-hidden="true"></i> {t('deleteWork.button')}
                            </button>
                        </div>
                </Modal>
            )}

            {/* Work Status Confirmation Modal */}
            {confirmationModal.show && confirmationModal.work && (() => {
                const config = getConfirmationModalContent();
                if (!config) return null;
                return (
                    <Modal
                        isOpen={true}
                        onClose={closeConfirmationModal}
                        contentClassName={`whatsapp-modal ${styles.confirmDialog}`}
                        ariaLabelledBy="confirm-action-title"
                    >
                            <div className={config.tone}>
                                <ModalHeader
                                    title={config.title}
                                    titleId="confirm-action-title"
                                    icon={<i className={`fas ${config.icon}`} aria-hidden="true" />}
                                    variant={confirmationModal.type === 'complete' ? 'success' : confirmationModal.type === 'discontinue' ? 'warning' : 'info'}
                                    onClose={closeConfirmationModal}
                                />
                                <div className={styles.confirmBody}>
                                    <p className={styles.confirmIntro}>
                                        {config.message}
                                    </p>
                                    <div className={styles.confirmDetailsBox}>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>{t('common.workType')}:</strong> {config.work.type_name || t('common.na')}
                                        </p>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>{t('common.doctor')}:</strong> {config.work.doctor_name || t('common.na')}
                                        </p>
                                        <p className={styles.confirmDetailLine}>
                                            <strong>{t('common.totalRequired')}:</strong> {formatCurrency(config.work.total_required, config.work.currency)}
                                        </p>
                                    </div>
                                    <p className={styles.confirmWarning}>
                                        {config.warning}
                                    </p>
                                </div>
                                <div className="whatsapp-actions">
                                    <button onClick={closeConfirmationModal} className="whatsapp-btn-cancel">
                                        <i className="fas fa-times" aria-hidden="true"></i> {t('common.cancel')}
                                    </button>
                                    <button
                                        onClick={executeConfirmedAction}
                                        className={`whatsapp-btn-send ${styles.confirmActionButton}`}
                                    >
                                        <i className={`fas ${config.buttonIcon}`} aria-hidden="true"></i> {config.buttonText}
                                    </button>
                                </div>
                            </div>
                    </Modal>
                );
            })()}

            {/* Transfer Work Modal (Admin Only) */}
            {showTransferModal && workToTransfer && (
                <TransferWorkModal
                    work={workToTransfer}
                    onClose={() => {
                        setShowTransferModal(false);
                        setWorkToTransfer(null);
                    }}
                    onSuccess={handleTransferSuccess}
                />
            )}
        </div>
    );
};

export default React.memo(WorkComponent);
