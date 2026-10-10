/**
 * NewWorkComponent - Standalone form for adding/editing works
 *
 * Compact, space-efficient form with keyword management
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useUnsavedRouteGuard } from '../../hooks/useUnsavedRouteGuard';
import { useLookupManager } from '../../hooks/useLookupManager';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, parseFormattedNumber, formatLocaleDate } from '../../utils/formatters';
import { formatISODate } from '../../core/utils';
import { buildWorkUpdatePayload, type WorkEditFields } from '../../utils/workUpdatePayload';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { postJSON, putJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { useToast } from '../../contexts/ToastContext';
import { qk } from '@/query/keys';
import { invalidateApprovals } from '@/services/approvals';
import * as workContract from '@shared/contracts/work.contract';
import { WORK_CURRENCIES, DEFAULT_WORK_CURRENCY_OPTION, parseWorkCurrency } from '@shared/work-currency';
import {
    workTypesQuery,
    workKeywordsQuery,
    workDoctorsQuery,
    optionQuery,
    worksQuery,
} from '../../query/queries';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './NewWorkComponent.module.css';

interface WorkType {
    id: number;
    work_type: string;
}

interface Keyword {
    id: number;
    key_word: string | null; // keywords.key_word is nullable; rendered directly
}

interface Doctor {
    id: number;
    employee_name: string;
}

interface ExistingWorkData {
    workId: number;
    typeName?: string;
    typeOfWork?: number;
    doctor?: string;
    totalRequired?: number;
    currency?: string;
    additionDate?: string;
}

/**
 * Shape of the conflicting work carried on a DUPLICATE_ACTIVE_WORK / 409 error
 * body. The dialog reads the `ExistingWorkData` fields; the 409 message reads the
 * alternate `type`/`work_id` aliases — both kept optional so either payload fits.
 */
type WorkConflictExisting = ExistingWorkData & { type?: string; work_id?: number };

interface WorkFormData extends WorkEditFields {
    person_id: string;
    createAsFinished: boolean;
}

interface NewWorkComponentProps {
    personId?: number | null;
    workId?: number | null;
    /** The save went through (or was held for approval); the caller navigates away. */
    onSave?: () => void;
    onCancel?: () => void;
}

type TabType = 'basic' | 'dates' | 'keywords';

/** The tabs, in order — ids for the tablist/tabpanel wiring. */
const TABS: readonly { id: TabType; icon: string; label: string }[] = [
    { id: 'basic', icon: 'fa-info-circle', label: 'Basic Info' },
    { id: 'dates', icon: 'fa-calendar', label: 'Dates' },
    { id: 'keywords', icon: 'fa-tags', label: 'Keywords' },
];

const EMPTY_FORM: WorkFormData = {
    person_id: '',
    total_required: 0, // Default to 0 instead of empty string (matches DB default)
    // Seeded below from the clinic default (new work) or the work's own currency (edit).
    // Never a literal: this used to be 'USD' in a clinic whose works are 79 % IQD.
    currency: '',
    type_of_work: '',
    notes: '',
    status: 1, // 1=Active, 2=Finished, 3=Discontinued
    start_date: '',
    debond_date: '',
    f_photo_date: '',
    i_photo_date: '',
    estimated_duration: '',
    dr_id: '',
    notes_date: '',
    keyword_id_1: '',
    keyword_id_2: '',
    keyword_id_3: '',
    keyword_id_4: '',
    keyword_id_5: '',
    discount: 0,
    discount_date: '',
    discount_reason: '',
    createAsFinished: false
};

const NewWorkComponent = ({ personId, workId = null, onSave, onCancel }: NewWorkComponentProps) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Dropdown reads — each its own independent query (one failing can't blank
    // the others). Loose contract responses expose long-tail fields as unknown,
    // so each `data` is cast to its concrete row type.
    const { data: workTypesData } = useQuery(workTypesQuery());
    const { data: keywordsData } = useQuery(workKeywordsQuery());
    // Right-click a Keyword dropdown → edit the keyword list here, or open it in
    // Settings → Lookups (this page's unsaved-work guard asks before leaving).
    const keywordLookup = useLookupManager({
        tableKey: 'tblKeyWord',
        invalidateKeys: [qk.lookups.workKeywords()],
    });
    // Who a work can be attributed to: Doctor-position employees + anyone on commission
    // (FE-F7-1). It used to be `employees?percentage=true` — the commission flag alone —
    // which left salaried doctors and the Clinic pseudo-doctor out, and a salaried-only
    // center with an EMPTY required list.
    const { data: workDoctorsData } = useQuery(workDoctorsQuery());
    // The clinic's default work currency (Settings → General). A missing/blank/unknown
    // value means "no default" — the select then starts empty and must be chosen.
    const { data: defaultCurrencyOption } = useQuery(optionQuery(DEFAULT_WORK_CURRENCY_OPTION));
    const defaultCurrency = parseWorkCurrency(defaultCurrencyOption?.value);

    const workTypes: WorkType[] = workTypesData ?? [];
    const keywords: Keyword[] = keywordsData ?? [];
    const workDoctors: Doctor[] = workDoctorsData ?? [];

    // Work record read (edit mode) — fetches the patient's works and the
    // form-population effect below picks out this workId. Matches the original
    // /api/getworks?code= + .find logic.
    const {
        data: worksData,
        isLoading: workLoading,
        error: workError,
    } = useQuery({
        ...worksQuery(personId ?? ''),
        enabled: !!workId && !!personId,
    });

    const [activeTab, setActiveTab] = useState<TabType>('basic');
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [existingWorkData, setExistingWorkData] = useState<ExistingWorkData | null>(null);
    const [pendingFormData, setPendingFormData] = useState<WorkFormData | null>(null);
    const [showFinishedWorkConfirm, setShowFinishedWorkConfirm] = useState(false);

    // Form state. `baseline` is what the form opened with (after seeding), so "dirty"
    // means the user changed something — the unsaved-work guard below reads it.
    const initialForm: WorkFormData = { ...EMPTY_FORM, person_id: personId ? String(personId) : '' };
    const [formData, setFormData] = useState<WorkFormData>(initialForm);
    const [baseline, setBaseline] = useState<WorkFormData>(initialForm);
    // Every field write goes through the functional updater: a spread of the render's
    // `formData` loses a concurrent write (FE-F6-4's shape, FE-F7-15).
    const setField = <K extends keyof WorkFormData>(key: K, value: WorkFormData[K]) =>
        setFormData(prev => ({ ...prev, [key]: value }));

    // Display state for formatted values
    const [displayValues, setDisplayValues] = useState({
        total_required: '',
        discount: ''
    });

    // The work being edited, live from the works read. Its payments total and its doctor
    // are read from it on every render (a colleague's payment on another PC moves them),
    // while the FORM is seeded from it once — below.
    const existingWork = workId ? worksData?.find(w => w.work_id === workId) : undefined;
    // Existing work financial facts (discount validation, the currency lock)
    const existingTotalPaid = Number(existingWork?.TotalPaid ?? 0);
    // The work's CURRENT doctor (edit mode), kept so the Doctor select can always show
    // it — a quit doctor, or anyone else outside the work-doctor list (FE-F7-1).
    const currentDoctor: Doctor | null = existingWork?.dr_id != null
        ? { id: existingWork.dr_id, employee_name: `${existingWork.doctor_name ?? `#${existingWork.dr_id}`} (current)` }
        : null;

    const user = useAuthUser();
    // Clinical staff (doctors/assistants) add works without a cost — the cost/
    // currency inputs and the "mark as finished" (paid) shortcut are finance-only.
    // Editing a work (and finishing one) is `editRecords`; a direct discount is `adminWrites`.
    const caps = roleCaps(user?.role as UserRole | undefined);

    // A NEW work's currency starts at the clinic default once it has loaded — never over
    // a currency the user already picked, and never in edit mode (the work's own wins).
    // The baseline takes it too: a default is not a change the user made.
    const [defaultCurrencyApplied, setDefaultCurrencyApplied] = useState(false);
    if (!workId && !defaultCurrencyApplied && defaultCurrency) {
        setDefaultCurrencyApplied(true);
        if (!formData.currency) {
            setFormData(prev => ({ ...prev, currency: defaultCurrency }));
            setBaseline(prev => ({ ...prev, currency: defaultCurrency }));
        }
    }

    // The select's options: the work-doctor list, plus the work's own doctor when it is
    // not on it, so opening an old work never blanks a required field and never forces a
    // re-attribution (which would move that work's commissions retroactively).
    const doctors: Doctor[] =
        currentDoctor && !workDoctors.some(d => d.id === currentDoctor.id)
            ? [...workDoctors, currentDoctor]
            : workDoctors;

    // Auto-format the display value when the matching formData field changes — done
    // during render (keyed on the field) so there's no setState-in-effect.
    const [fmtTotalRequired, setFmtTotalRequired] = useState(formData.total_required);
    if (fmtTotalRequired !== formData.total_required) {
        setFmtTotalRequired(formData.total_required);
        setDisplayValues(prev => ({
            ...prev,
            total_required: formatNumber(formData.total_required)
        }));
    }

    const [fmtDiscount, setFmtDiscount] = useState(formData.discount);
    if (fmtDiscount !== formData.discount) {
        setFmtDiscount(formData.discount);
        setDisplayValues(prev => ({
            ...prev,
            discount: formData.discount ? formatNumber(formData.discount) : ''
        }));
    }

    // Populate the form ONCE per work, when its row first arrives (edit mode). It used to
    // re-seed on every refetch that changed data, so a colleague's payment on another PC
    // wiped the edits in progress here (FE-F7-15). Same nullish-coalescing (preserve 0)
    // and String(...) coercion as the old loadWorkData.
    const [seededWorkId, setSeededWorkId] = useState<number | null>(null);
    if (existingWork && seededWorkId !== workId) {
        setSeededWorkId(workId);
        {
            const work = existingWork;
            const discountDateISO = work.discount_date ? formatISODate(work.discount_date) : '';
            const discountValue = Number(work.discount ?? 0);
            const seeded: WorkFormData = {
                person_id: String(work.person_id),
                total_required: work.total_required ?? 0, // Use nullish coalescing to preserve 0
                currency: work.currency ?? '',
                type_of_work: String(work.type_of_work || ''),
                notes: work.notes || '',
                status: work.status ?? 1, // Use nullish coalescing to preserve 0 if somehow status is 0
                start_date: work.start_date ? formatISODate(work.start_date) : '',
                debond_date: work.debond_date ? formatISODate(work.debond_date) : '',
                f_photo_date: work.f_photo_date ? formatISODate(work.f_photo_date) : '',
                i_photo_date: work.i_photo_date ? formatISODate(work.i_photo_date) : '',
                estimated_duration: String(work.estimated_duration || ''),
                dr_id: String(work.dr_id || ''),
                notes_date: work.notes_date ? formatISODate(work.notes_date) : '',
                keyword_id_1: String(work.keyword_id_1 || ''),
                keyword_id_2: String(work.keyword_id_2 || ''),
                keyword_id_3: String(work.keyword_id_3 || ''),
                keyword_id_4: String(work.keyword_id_4 || ''),
                keyword_id_5: String(work.keyword_id_5 || ''),
                discount: discountValue,
                discount_date: discountDateISO,
                discount_reason: work.discount_reason || '',
                createAsFinished: false
            };
            setFormData(seeded);
            setBaseline(seeded);
        }
    }

    // Unsaved-work guard for this full-page form (FE-F7-15): leaving with changes asks
    // first, through the same dialog the modal forms use.
    const dirty = JSON.stringify(formData) !== JSON.stringify(baseline);
    const { allowNextNavigation } = useUnsavedRouteGuard(dirty);
    const finishSave = () => {
        allowNextNavigation();
        onSave?.();
    };

    // Surface a work-record load failure in the existing error banner (the old
    // loadWorkData did setError(...) on its catch), once per error transition.
    const [prevWorkError, setPrevWorkError] = useState(workError);
    if (workError !== prevWorkError) {
        setPrevWorkError(workError);
        if (workError) {
            setError(httpErrorMessage(workError, 'Failed to fetch work data'));
        }
    }

    const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);

        // If createAsFinished is checked and we're adding a new work, show confirmation dialog
        if (!workId && formData.createAsFinished) {
            // Validate before showing confirmation
            if (!formData.total_required || formData.total_required <= 0) {
                setError('Cannot create finished work: Total Required must be greater than 0');
                return;
            }
            if (!formData.currency) {
                setError('Cannot create finished work: Currency must be selected');
                return;
            }
            setShowFinishedWorkConfirm(true);
            return;
        }

        // Continue with normal submission
        await performSubmit();
    };

    const performSubmit = async () => {
        try {
            setLoading(true);

            if (workId) {
                // Update existing work: only what the user changed (see workUpdatePayload).
                // The server decides who may change what; a money edit on an old work by
                // the front desk comes back 'pending'.
                const updatePayload = buildWorkUpdatePayload(workId, formData, baseline, formatISODate());
                if (!updatePayload) {
                    // Saved with nothing changed: there is nothing to write.
                    finishSave();
                    return;
                }
                // Non-admin discount changes are diverted server-side into the
                // admin approval queue (outcome 'pending' below) — send them as-is.
                const updateResult = await putJSON<{ outcome: string }>('/api/updatework', updatePayload, { schema: workContract.updateWork.response });
                if (updateResult.outcome === 'pending') {
                    toast.success('Submitted for admin approval');
                    // A request was created but no row changed — tell the approval bells
                    // (they only hear about a RESOLVED request otherwise, and poll every 5 min).
                    void invalidateApprovals();
                    finishSave();
                    return;
                }
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
                queryClient.invalidateQueries({ queryKey: qk.work.all(workId) });
            } else {
                // Add new work - use special endpoint if createAsFinished is true
                // Strip discount fields from creation payload (not supported at creation)
                const { discount: _d, discount_date: _dd, discount_reason: _dr, ...creationData } = formData;
                void _d; void _dd; void _dr;
                const endpoint = formData.createAsFinished ? '/api/addWorkWithInvoice' : '/api/addwork';
                // Schema matches the chosen endpoint ({ workId } vs { workId, invoiceId }).
                const schema = formData.createAsFinished
                    ? workContract.addWorkWithInvoice.response
                    : workContract.addWork.response;
                await postJSON(endpoint, creationData, { schema });
                // Refresh the patient's works list (+ info/timepoints) so the new
                // work shows immediately on navigating back — without this the
                // still-fresh cache (30s staleTime) serves the stale list until a
                // hard refresh. Mirrors the update/finish-existing branches.
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            }

            finishSave();
        } catch (err) {
            // Conflict context travels on the thrown HttpError's parsed body. The standard
            // envelope nests code/existingWork under `details`; the top-level keys are kept
            // as a fallback for any older shape.
            const httpErr = err as HttpError;
            const errorData = httpErr.data as {
                code?: string;
                message?: string;
                error?: string;
                existingWork?: WorkConflictExisting;
                details?: { code?: string; message?: string; existingWork?: WorkConflictExisting };
            } | undefined;

            const errorCode = errorData?.details?.code || errorData?.code;
            if (errorCode === 'DUPLICATE_ACTIVE_WORK') {
                // Show confirmation dialog instead of error
                setExistingWorkData(errorData?.details?.existingWork || errorData?.existingWork || null);
                setPendingFormData(formData);
                setShowConfirmDialog(true);
                return;
            }

            // Handle 409 Conflict - Status change conflict (Active work already exists).
            const conflictWork = errorData?.details?.existingWork || errorData?.existingWork;
            if (httpErr.status === 409 && conflictWork) {
                setError(
                    `Cannot activate this work: Patient already has an active work:\n\n` +
                    `Work Type: ${conflictWork.type || 'N/A'}\n` +
                    `Doctor: ${conflictWork.doctor || 'N/A'}\n` +
                    `Work ID: ${conflictWork.work_id}\n\n` +
                    `Please finish or discontinue the existing work first.`
                );
                return;
            }

            // Extract error message properly (details.message > server error/message > fallback).
            setError(errorData?.details?.message || httpErrorMessage(err, 'Failed to save work'));
        } finally {
            setLoading(false);
        }
    };

    const handleFinishExistingAndAddNew = async () => {
        try {
            setLoading(true);
            setShowConfirmDialog(false);

            // First, finish the existing work (re-wrap any failure with its own message).
            await postJSON('/api/finishwork', { workId: existingWorkData?.workId })
                .catch((finishErr) => {
                    throw new Error(httpErrorMessage(finishErr, 'Failed to finish existing work'));
                });
            if (existingWorkData?.workId) {
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
                queryClient.invalidateQueries({ queryKey: qk.work.all(existingWorkData.workId) });
            }

            // Now add the new work
            const pendingCreation = pendingFormData
                ? (() => {
                      const { discount: _d, discount_date: _dd, discount_reason: _dr, ...rest } = pendingFormData;
                      void _d; void _dd; void _dr;
                      return rest;
                  })()
                : pendingFormData;
            await postJSON('/api/addwork', pendingCreation, { schema: workContract.addWork.response })
                .catch((addErr) => {
                    throw new Error(httpErrorMessage(addErr, 'Failed to add new work'));
                });
            // Refresh again after the new work lands so the works list reflects it
            // immediately on navigating back (the earlier invalidate ran before this add).
            queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            finishSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
            setExistingWorkData(null);
            setPendingFormData(null);
        }
    };

    const handleCancelConfirmation = () => {
        setShowConfirmDialog(false);
        setExistingWorkData(null);
        setPendingFormData(null);
        setLoading(false);
    };

    const handleConfirmFinishedWork = async () => {
        setShowFinishedWorkConfirm(false);
        await performSubmit();
    };

    const handleCancelFinishedWork = () => {
        setShowFinishedWorkConfirm(false);
    };

    // The three tabs are CSS-hidden, not unmounted, so a required field left empty on a
    // tab that is not showing blocks Save with no message at all — the browser cannot
    // focus a hidden control, so it drops its own bubble (FE-F7-1: saving from Dates or
    // Keywords). Show the tab holding the FIRST invalid control, then let the browser
    // report it. Every invalid control fires this; they all resolve to the same tab, and
    // the re-fired event from reportValidity() finds that tab already active.
    const handleFormInvalid = (e: FormEvent<HTMLFormElement>) => {
        const firstInvalid = e.currentTarget.querySelector<HTMLInputElement>(
            'input:invalid, select:invalid, textarea:invalid'
        );
        const tab = firstInvalid?.closest<HTMLElement>('[data-tab]')?.dataset.tab as TabType | undefined;
        if (!firstInvalid || !tab || tab === activeTab) return;
        setActiveTab(tab);
        requestAnimationFrame(() => firstInvalid.reportValidity());
    };

    // Editing a work is FINANCE_ROLES on the server (PUT /api/updatework). A doctor or
    // assistant who reaches `new-work?workId=` would otherwise fill the whole form and
    // learn "Insufficient permissions" only at Save (FE-F7-7). Gated only once the role
    // is known, so an admin's cold load never flashes this.
    if (workId && user && !caps.editRecords) {
        return (
            <div className={styles.newWorkComponent}>
                <div className={styles.newWorkError}>
                    <i className="fas fa-lock" aria-hidden="true"></i> Editing a work is done by the front desk or an admin.
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (workLoading && workId) {
        return (
            <div className={styles.newWorkLoading}>
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading work data...
            </div>
        );
    }

    // A stale or deleted workId used to render a BLANK edit form (FE-F7-15).
    if (workId && worksData && !existingWork) {
        return (
            <div className={styles.newWorkComponent}>
                <div className={styles.newWorkError} role="alert">
                    <i className="fas fa-exclamation-circle" aria-hidden="true"></i> This work no longer exists — it may have been deleted or moved to another patient.
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.newWorkComponent}>
            {/* Header */}
            <div className={styles.newWorkHeader}>
                <h3>
                    <i className="fas fa-tooth" aria-hidden="true"></i> {workId ? 'Edit Work' : 'Add New Work'}
                </h3>
            </div>

            {/* Error Display */}
            {error && (
                <div className={styles.newWorkError}>
                    <i className="fas fa-exclamation-circle" aria-hidden="true"></i> {error}
                    <button onClick={() => setError(null)} className={styles.errorClose}>×</button>
                </div>
            )}

            {/* Confirmation Dialog for Duplicate Active Work */}
            {showConfirmDialog && existingWorkData && (
                <Modal
                    isOpen
                    onClose={handleCancelConfirmation}
                    closeOnBackdropClick={!loading}
                    closeOnEscape={!loading}
                    contentClassName={styles.confirmationDialog}
                    ariaLabelledBy="duplicate-work-title"
                >
                        <ModalHeader
                            title="Active Work Already Exists"
                            titleId="duplicate-work-title"
                            icon={<i className="fas fa-exclamation-triangle" aria-hidden="true" />}
                            variant="warning"
                            onClose={loading ? undefined : handleCancelConfirmation}
                        />
                        <div className={styles.confirmationBody}>
                            <p>This patient already has an active work record:</p>
                            <div className={styles.existingWorkDetails}>
                                <div className={styles.detailRow}>
                                    <strong>Work Type:</strong> {existingWorkData.typeName || `Type ${existingWorkData.typeOfWork}`}
                                </div>
                                <div className={styles.detailRow}>
                                    <strong>Doctor:</strong> {existingWorkData.doctor || 'N/A'}
                                </div>
                                <div className={styles.detailRow}>
                                    <strong>Total Required:</strong> {existingWorkData.totalRequired} {existingWorkData.currency}
                                </div>
                                <div className={styles.detailRow}>
                                    <strong>Added:</strong> {formatLocaleDate(existingWorkData.additionDate) || 'N/A'}
                                </div>
                            </div>
                            <p className={styles.confirmationQuestion}>
                                {/* Finishing a work is FINANCE_ROLES (POST /api/finishwork) — a
                                    doctor or assistant is offered only what will succeed. */}
                                {caps.editRecords
                                    ? 'Would you like to finish the existing work and add this new one?'
                                    : 'The existing work has to be finished first — ask the front desk to finish it, then add this one.'}
                            </p>
                        </div>
                        <div className={styles.confirmationActions}>
                            {caps.editRecords && (
                                <button
                                    onClick={handleFinishExistingAndAddNew}
                                    className="btn btn-primary"
                                    disabled={loading}
                                >
                                    <i className="fas fa-check" aria-hidden="true"></i> Yes, Finish & Add New
                                </button>
                            )}
                            <button
                                onClick={handleCancelConfirmation}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times" aria-hidden="true"></i> Cancel
                            </button>
                        </div>
                </Modal>
            )}

            {/* Confirmation Dialog for Finished Work with Invoice */}
            {showFinishedWorkConfirm && (
                <Modal
                    isOpen
                    onClose={handleCancelFinishedWork}
                    closeOnBackdropClick={!loading}
                    closeOnEscape={!loading}
                    contentClassName={styles.confirmationDialog}
                    ariaLabelledBy="finished-work-title"
                >
                        <ModalHeader
                            title="Confirm Completed Work Creation"
                            titleId="finished-work-title"
                            icon={<i className="fas fa-check-circle" aria-hidden="true" />}
                            variant="success"
                            onClose={loading ? undefined : handleCancelFinishedWork}
                        />
                        <div className={styles.confirmationBody}>
                            <p>You are about to create:</p>
                            <div className={styles.existingWorkDetails}>
                                <div className={styles.detailSection}>
                                    <h4><i className="fas fa-tooth" aria-hidden="true"></i> New Work (FINISHED)</h4>
                                    <div className={styles.detailRow}>
                                        <strong>Type:</strong> {workTypes.find(t => String(t.id) === formData.type_of_work)?.work_type || 'N/A'}
                                    </div>
                                    <div className={styles.detailRow}>
                                        <strong>Doctor:</strong> {doctors.find(d => String(d.id) === formData.dr_id)?.employee_name || 'N/A'}
                                    </div>
                                    <div className={styles.detailRow}>
                                        <strong>Total:</strong> {formData.total_required} {formData.currency}
                                    </div>
                                    <div className={styles.detailRow}>
                                        <strong>Status:</strong> <span className={styles.statusCompleted}>Completed</span>
                                    </div>
                                </div>
                                <div className={styles.detailSection}>
                                    <h4><i className="fas fa-file-invoice-dollar" aria-hidden="true"></i> Full Payment Invoice</h4>
                                    <div className={styles.detailRow}>
                                        <strong>Amount:</strong> {formData.total_required} {formData.currency}
                                    </div>
                                    <div className={styles.detailRow}>
                                        <strong>Date:</strong> Today ({formatLocaleDate(new Date())})
                                    </div>
                                </div>
                            </div>
                            <p className={styles.confirmationQuestion}>
                                <strong>This work will be marked as fully paid and finished immediately.</strong>
                            </p>
                        </div>
                        <div className={styles.confirmationActions}>
                            <button
                                onClick={handleConfirmFinishedWork}
                                className="btn btn-primary"
                                disabled={loading}
                            >
                                <i className="fas fa-check" aria-hidden="true"></i> Confirm & Create
                            </button>
                            <button
                                onClick={handleCancelFinishedWork}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times" aria-hidden="true"></i> Cancel
                            </button>
                        </div>
                </Modal>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} onInvalid={handleFormInvalid} className={styles.newWorkForm}>
                {/* Top Action Buttons */}
                <div className={`${styles.formActions} ${styles.topActions}`}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save" aria-hidden="true"></i> {loading ? 'Saving...' : (workId ? 'Update' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times" aria-hidden="true"></i> Cancel
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className={styles.workTabs} role="tablist" aria-label="Work form sections">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            id={`work-tab-${tab.id}`}
                            aria-selected={activeTab === tab.id}
                            aria-controls={`work-tabpanel-${tab.id}`}
                            className={`${styles.workTab} ${activeTab === tab.id ? styles.workTabActive : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <i className={`fas ${tab.icon}`} aria-hidden="true"></i> {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab 1: Basic Information */}
                <div
                    data-tab="basic"
                    role="tabpanel"
                    id="work-tabpanel-basic"
                    aria-labelledby="work-tab-basic"
                    className={`${styles.tabContent} ${activeTab === 'basic' ? styles.tabContentActive : ''}`}
                >
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-type">Work Type <span className={styles.required}>*</span></label>
                            <select
                                id="work-type"
                                value={formData.type_of_work}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('type_of_work', e.target.value)}
                                required
                            >
                                <option value="">Select Type</option>
                                {workTypes.map(type => (
                                    <option key={type.id} value={type.id}>
                                        {type.work_type}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-doctor">Doctor <span className={styles.required}>*</span></label>
                            <select
                                id="work-doctor"
                                name="dr_id"
                                value={formData.dr_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('dr_id', e.target.value)}
                                required
                            >
                                <option value="">Select Doctor</option>
                                {doctors.map(doctor => (
                                    <option key={doctor.id} value={doctor.id}>
                                        {doctor.employee_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {workId && (
                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label htmlFor="work-status">Status <span className={styles.required}>*</span></label>
                                <select
                                    id="work-status"
                                    value={formData.status}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setField('status', parseInt(e.target.value, 10))}
                                    required
                                >
                                    <option value={1}>Active</option>
                                    <option value={2}>Finished</option>
                                    <option value={3}>Discontinued</option>
                                </select>
                                {formData.status === 2 && (
                                    <small className={`${styles.formHint} ${styles.textWarning}`}>
                                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i> Finishing a work marks the treatment as completed
                                    </small>
                                )}
                                {formData.status === 3 && (
                                    <small className={`${styles.formHint} ${styles.textWarning}`}>
                                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i> Discontinuing a work indicates the patient abandoned treatment
                                    </small>
                                )}
                            </div>
                        </div>
                    )}

                    {caps.writeFinance && (
                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label htmlFor="work-total-required">Total Required</label>
                                <input
                                    id="work-total-required"
                                    type="text"
                                    value={displayValues.total_required}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                        const numericValue = parseFormattedNumber(e.target.value) || 0;
                                        // The amount NEVER touches the currency. It used to switch to IQD
                                        // on any keystroke past 10,000, one way — so editing $2,000 in place
                                        // (End, 0, Backspace) saved 2,000 IQD (FE-F7-3). The default now
                                        // comes from the clinic setting instead.
                                        setFormData(prev => ({ ...prev, total_required: numericValue }));
                                        setDisplayValues(prev => ({...prev, total_required: e.target.value}));
                                    }}
                                    onBlur={() => {
                                        setDisplayValues(prev => ({...prev, total_required: formatNumber(formData.total_required)}));
                                    }}
                                    placeholder="Enter amount (defaults to 0)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label htmlFor="work-currency">Currency <span className={styles.required}>*</span></label>
                                <select
                                    id="work-currency"
                                    name="currency"
                                    value={formData.currency}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData(prev => ({ ...prev, currency: e.target.value }))}
                                    required
                                    // Payments are stored as bare amounts in the work's currency, so
                                    // once any have been received the currency is part of what they
                                    // mean. The server refuses the change (CURRENCY_LOCKED) — this
                                    // just stops the user building an edit that cannot be saved.
                                    disabled={!!workId && existingTotalPaid > 0}
                                >
                                    <option value="" disabled>Select currency</option>
                                    {WORK_CURRENCIES.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                {!!workId && existingTotalPaid > 0 && (
                                    <small className={styles.formHint}>
                                        <i className="fas fa-lock" aria-hidden="true"></i> Locked — this work already has payments
                                    </small>
                                )}
                            </div>
                        </div>
                    )}

                    {!workId && caps.writeFinance && (
                        <div className={styles.formRow}>
                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label className={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={formData.createAsFinished}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setField('createAsFinished', e.target.checked)}
                                        disabled={!formData.total_required || formData.total_required <= 0}
                                    />
                                    <span>
                                        <i className="fas fa-check-circle" aria-hidden="true"></i> Mark as fully paid and finished
                                    </span>
                                </label>
                                <small className={styles.formHint}>
                                    Creates an invoice for the full amount and marks the work as completed
                                </small>
                            </div>
                        </div>
                    )}

                    {workId && (
                        <>
                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label htmlFor="work-discount">
                                        Discount
                                        {!caps.adminWrites && (
                                            <small className={`${styles.formHint} ${styles.adminHint}`}>
                                                <i className="fas fa-user-check" aria-hidden="true"></i> Requires admin approval
                                            </small>
                                        )}
                                    </label>
                                    <input
                                        id="work-discount"
                                        type="text"
                                        value={displayValues.discount}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                            const numericValue = parseFormattedNumber(e.target.value) || 0;
                                            setField('discount', numericValue);
                                            setDisplayValues(prev => ({ ...prev, discount: e.target.value }));
                                        }}
                                        onBlur={() => {
                                            setDisplayValues(prev => ({
                                                ...prev,
                                                discount: formData.discount ? formatNumber(formData.discount) : ''
                                            }));
                                        }}
                                        placeholder="0"
                                    />
                                    {formData.discount > 0 && formData.discount > (formData.total_required - existingTotalPaid) && (
                                        <small className={`${styles.formHint} ${styles.textWarning}`}>
                                            <i className="fas fa-exclamation-triangle" aria-hidden="true"></i> Discount cannot exceed Total Required minus Total Paid ({formatNumber(formData.total_required - existingTotalPaid)} {formData.currency})
                                        </small>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="work-discount-date">Discount Date</label>
                                    <input
                                        id="work-discount-date"
                                        type="date"
                                        value={formData.discount_date}
                                        disabled={formData.discount <= 0}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setField('discount_date', e.target.value)}
                                    />
                                    {formData.discount > 0 && !formData.discount_date && (
                                        <small className={styles.formHint}>
                                            Will default to today if left blank
                                        </small>
                                    )}
                                </div>
                            </div>

                            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                                <label htmlFor="work-discount-reason">Discount Reason <small className={styles.optionalHint}>(optional)</small></label>
                                <textarea
                                    id="work-discount-reason"
                                    value={formData.discount_reason}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setField('discount_reason', e.target.value)}
                                    rows={2}
                                    maxLength={500}
                                    placeholder="Why was the discount granted? (visible on work card, not on receipt)"
                                />
                            </div>
                        </>
                    )}

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-start-date">Start Date</label>
                            <input
                                id="work-start-date"
                                type="date"
                                value={formData.start_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('start_date', e.target.value)}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-estimated-duration">Estimated Duration (months)</label>
                            <input
                                id="work-estimated-duration"
                                type="number"
                                value={formData.estimated_duration}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('estimated_duration', e.target.value)}
                                min="1"
                                max="255"
                            />
                        </div>
                    </div>

                    <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                        <label htmlFor="work-notes">Notes</label>
                        <textarea
                            id="work-notes"
                            value={formData.notes}
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setField('notes', e.target.value)}
                            rows={3}
                            placeholder="Additional notes about this work..."
                        />
                    </div>
                </div>

                {/* Tab 2: Dates */}
                <div
                    data-tab="dates"
                    role="tabpanel"
                    id="work-tabpanel-dates"
                    aria-labelledby="work-tab-dates"
                    className={`${styles.tabContent} ${activeTab === 'dates' ? styles.tabContentActive : ''}`}
                >
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-i-photo-date">Initial Photo Date</label>
                            <input
                                id="work-i-photo-date"
                                type="date"
                                value={formData.i_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('i_photo_date', e.target.value)}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-f-photo-date">Final Photo Date</label>
                            <input
                                id="work-f-photo-date"
                                type="date"
                                value={formData.f_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('f_photo_date', e.target.value)}
                            />
                        </div>
                    </div>

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-debond-date">Debond Date</label>
                            <input
                                id="work-debond-date"
                                type="date"
                                value={formData.debond_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('debond_date', e.target.value)}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-notes-date">Notes Date</label>
                            <input
                                id="work-notes-date"
                                type="date"
                                value={formData.notes_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setField('notes_date', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Tab 3: Keywords */}
                <div
                    data-tab="keywords"
                    role="tabpanel"
                    id="work-tabpanel-keywords"
                    aria-labelledby="work-tab-keywords"
                    className={`${styles.tabContent} ${activeTab === 'keywords' ? styles.tabContentActive : ''}`}
                >
                    <div className={styles.keywordsSection}>
                        <p className={styles.sectionHint}>
                            <i className="fas fa-info-circle" aria-hidden="true"></i> Select up to 5 keywords to categorize this work
                            {keywordLookup.canManage && ' — right-click a list to add or rename keywords'}
                        </p>
                        <div className={styles.keywordsGrid}>
                            {([1, 2, 3, 4, 5] as const).map(num => {
                                // Get the keyword field value with proper type handling
                                const keywordValue = formData[`keyword_id_${num}`];
                                return (
                                <div key={num} className={styles.formGroup}>
                                    <label>Keyword {num}</label>
                                    <select
                                        value={keywordValue}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setField(`keyword_id_${num}`, e.target.value)}
                                        onContextMenu={keywordLookup.onContextMenu}
                                        title={keywordLookup.canManage ? 'Right-click to edit this list' : undefined}
                                    >
                                        <option value="">Select Keyword</option>
                                        {keywords.map(kw => (
                                            <option key={kw.id} value={kw.id}>
                                                {kw.key_word}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            );
                            })}
                        </div>
                        {keywordLookup.overlay}
                    </div>
                </div>

                {/* Bottom Form Actions */}
                <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save" aria-hidden="true"></i> {loading ? 'Saving...' : (workId ? 'Update Work' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times" aria-hidden="true"></i> Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewWorkComponent;
