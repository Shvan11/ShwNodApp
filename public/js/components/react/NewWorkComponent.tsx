/**
 * NewWorkComponent - Standalone form for adding/editing works
 *
 * Compact, space-efficient form with keyword management
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, parseFormattedNumber } from '../../utils/formatters';
import { formatISODate } from '../../core/utils';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { postJSON, putJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { useToast } from '../../contexts/ToastContext';
import { qk } from '@/query/keys';
import * as workContract from '@shared/contracts/work.contract';
import {
    workTypesQuery,
    workKeywordsQuery,
    employeesQuery,
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

interface WorkFormData {
    person_id: string;
    total_required: number;
    currency: string;
    type_of_work: string;
    notes: string;
    status: number;
    start_date: string;
    debond_date: string;
    f_photo_date: string;
    i_photo_date: string;
    estimated_duration: string;
    dr_id: string;
    notes_date: string;
    keyword_id_1: string;
    keyword_id_2: string;
    keyword_id_3: string;
    keyword_id_4: string;
    keyword_id_5: string;
    discount: number;
    discount_date: string;
    discount_reason: string;
    createAsFinished: boolean;
}

interface WorkResponse {
    work_id: number;
    person_id: number;
    type_of_work?: number;
    total_required?: number;
    currency?: string;
    notes?: string;
    status?: number;
    start_date?: string;
    debond_date?: string;
    f_photo_date?: string;
    i_photo_date?: string;
    estimated_duration?: number;
    dr_id?: number;
    notes_date?: string;
    keyword_id_1?: number;
    keyword_id_2?: number;
    keyword_id_3?: number;
    keyword_id_4?: number;
    keyword_id_5?: number;
    discount?: number | null;
    discount_date?: string | null;
    discount_reason?: string | null;
    TotalPaid?: number;
}

interface NewWorkComponentProps {
    personId?: number | null;
    workId?: number | null;
    onSave?: (result: WorkResponse) => void;
    onCancel?: () => void;
}

type TabType = 'basic' | 'dates' | 'keywords';

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
    const { data: employeesData } = useQuery(employeesQuery('?percentage=true'));

    const workTypes: WorkType[] = workTypesData ?? [];
    const keywords: Keyword[] = keywordsData ?? [];
    const doctors: Doctor[] = employeesData?.employees ?? [];

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

    // Form state
    const [formData, setFormData] = useState<WorkFormData>({
        person_id: personId ? String(personId) : '',
        total_required: 0, // Default to 0 instead of empty string (matches DB default)
        currency: 'USD',
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
    });

    // Display state for formatted values
    const [displayValues, setDisplayValues] = useState({
        total_required: '',
        discount: ''
    });

    // Existing work financial snapshot (for discount validation)
    const [existingTotalPaid, setExistingTotalPaid] = useState<number>(0);

    const { user } = useGlobalState();
    const isAdmin = user?.role === 'admin';
    // Clinical staff (doctors/assistants) add works without a cost — the cost/
    // currency inputs and the "mark as finished" (paid) shortcut are finance-only.
    const caps = roleCaps(user?.role as UserRole | undefined);

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

    // Populate the form when the works list arrives (edit mode), picking out the row
    // for this workId — keyed on (worksData, workId) so it re-seeds on refetch.
    // Mirrors the old loadWorkData population exactly — same nullish-coalescing
    // (preserve 0) and String(...) coercion.
    const [seededWork, setSeededWork] = useState<{ data: unknown; id: number | null }>({ data: null, id: null });
    if (seededWork.data !== worksData || seededWork.id !== workId) {
        setSeededWork({ data: worksData, id: workId });
        // worksData is the contracted WorkRow[]; the field reads below are all
        // null-safe (?? / || / ?:), so it's used directly — no cast.
        const work = worksData?.find(w => w.work_id === workId);
        if (work) {
            const discountDateISO = work.discount_date ? formatISODate(work.discount_date) : '';
            const discountValue = Number(work.discount ?? 0);
            setFormData({
                person_id: String(work.person_id),
                total_required: work.total_required ?? 0, // Use nullish coalescing to preserve 0
                currency: work.currency || 'USD',
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
            });
            setExistingTotalPaid(Number(work.TotalPaid ?? 0));
        }
    }

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

            // Both endpoints return the raw WorkResponse (no envelope) → fetchData passthrough.
            let result: WorkResponse;
            if (workId) {
                // Update existing work
                // Send all fields - backend middleware handles authorization
                // Backend will reject money field updates for old works if user is secretary
                const discountNum = Number(formData.discount) || 0;
                const updatePayload: Record<string, unknown> = {
                    workId,
                    ...formData,
                    discount: discountNum > 0 ? discountNum : null,
                    discount_date: discountNum > 0
                        ? (formData.discount_date || formatISODate())
                        : null,
                    discount_reason: discountNum > 0 ? (formData.discount_reason || null) : null
                };
                // Non-admin: don't send discount/discount_date so backend doesn't 403
                if (!isAdmin) {
                    delete updatePayload.discount;
                    delete updatePayload.discount_date;
                }
                const updateResult = await putJSON<{ outcome: string }>('/api/updatework', updatePayload, { schema: workContract.updateWork.response });
                if (updateResult.outcome === 'pending') {
                    toast.success('Submitted for admin approval');
                    if (onSave) onSave({} as WorkResponse);
                    return;
                }
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
                queryClient.invalidateQueries({ queryKey: qk.work.all(workId) });
                result = {} as WorkResponse;
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
                result = await postJSON<WorkResponse>(endpoint, creationData, { schema });
                // Refresh the patient's works list (+ info/timepoints) so the new
                // work shows immediately on navigating back — without this the
                // still-fresh cache (30s staleTime) serves the stale list until a
                // hard refresh. Mirrors the update/finish-existing branches.
                queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            }

            if (onSave) {
                onSave(result);
            }
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
            const result = await postJSON<WorkResponse>('/api/addwork', pendingCreation, { schema: workContract.addWork.response })
                .catch((addErr) => {
                    throw new Error(httpErrorMessage(addErr, 'Failed to add new work'));
                });
            // Refresh again after the new work lands so the works list reflects it
            // immediately on navigating back (the earlier invalidate ran before this add).
            queryClient.invalidateQueries({ queryKey: qk.patient.all(personId ?? '') });
            if (onSave) {
                onSave(result);
            }
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

    if (workLoading && workId) {
        return (
            <div className={styles.newWorkLoading}>
                <i className="fas fa-spinner fa-spin"></i> Loading work data...
            </div>
        );
    }

    return (
        <div className={styles.newWorkComponent}>
            {/* Header */}
            <div className={styles.newWorkHeader}>
                <h3>
                    <i className="fas fa-tooth"></i> {workId ? 'Edit Work' : 'Add New Work'}
                </h3>
            </div>

            {/* Error Display */}
            {error && (
                <div className={styles.newWorkError}>
                    <i className="fas fa-exclamation-circle"></i> {error}
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
                            icon={<i className="fas fa-exclamation-triangle" />}
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
                                    <strong>Added:</strong> {existingWorkData.additionDate ? new Date(existingWorkData.additionDate).toLocaleDateString() : 'N/A'}
                                </div>
                            </div>
                            <p className={styles.confirmationQuestion}>
                                Would you like to finish the existing work and add this new one?
                            </p>
                        </div>
                        <div className={styles.confirmationActions}>
                            <button
                                onClick={handleFinishExistingAndAddNew}
                                className="btn btn-primary"
                                disabled={loading}
                            >
                                <i className="fas fa-check"></i> Yes, Finish & Add New
                            </button>
                            <button
                                onClick={handleCancelConfirmation}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i> Cancel
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
                            icon={<i className="fas fa-check-circle" />}
                            variant="success"
                            onClose={loading ? undefined : handleCancelFinishedWork}
                        />
                        <div className={styles.confirmationBody}>
                            <p>You are about to create:</p>
                            <div className={styles.existingWorkDetails}>
                                <div className={styles.detailSection}>
                                    <h4><i className="fas fa-tooth"></i> New Work (FINISHED)</h4>
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
                                    <h4><i className="fas fa-file-invoice-dollar"></i> Full Payment Invoice</h4>
                                    <div className={styles.detailRow}>
                                        <strong>Amount:</strong> {formData.total_required} {formData.currency}
                                    </div>
                                    <div className={styles.detailRow}>
                                        <strong>Date:</strong> Today ({new Date().toLocaleDateString()})
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
                                <i className="fas fa-check"></i> Confirm & Create
                            </button>
                            <button
                                onClick={handleCancelFinishedWork}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i> Cancel
                            </button>
                        </div>
                </Modal>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} className={styles.newWorkForm}>
                {/* Top Action Buttons */}
                <div className={`${styles.formActions} ${styles.topActions}`}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className={styles.workTabs}>
                    <button
                        type="button"
                        className={`${styles.workTab} ${activeTab === 'basic' ? styles.workTabActive : ''}`}
                        onClick={() => setActiveTab('basic')}
                    >
                        <i className="fas fa-info-circle"></i> Basic Info
                    </button>
                    <button
                        type="button"
                        className={`${styles.workTab} ${activeTab === 'dates' ? styles.workTabActive : ''}`}
                        onClick={() => setActiveTab('dates')}
                    >
                        <i className="fas fa-calendar"></i> Dates
                    </button>
                    <button
                        type="button"
                        className={`${styles.workTab} ${activeTab === 'keywords' ? styles.workTabActive : ''}`}
                        onClick={() => setActiveTab('keywords')}
                    >
                        <i className="fas fa-tags"></i> Keywords
                    </button>
                </div>

                {/* Tab 1: Basic Information */}
                <div className={`${styles.tabContent} ${activeTab === 'basic' ? styles.tabContentActive : ''}`}>
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-type">Work Type <span className={styles.required}>*</span></label>
                            <select
                                id="work-type"
                                value={formData.type_of_work}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, type_of_work: e.target.value})}
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
                                value={formData.dr_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, dr_id: e.target.value})}
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
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, status: parseInt(e.target.value)})}
                                    required
                                >
                                    <option value={1}>Active</option>
                                    <option value={2}>Finished</option>
                                    <option value={3}>Discontinued</option>
                                </select>
                                {formData.status === 2 && (
                                    <small className={`${styles.formHint} ${styles.textWarning}`}>
                                        <i className="fas fa-exclamation-triangle"></i> Finishing a work marks the treatment as completed
                                    </small>
                                )}
                                {formData.status === 3 && (
                                    <small className={`${styles.formHint} ${styles.textWarning}`}>
                                        <i className="fas fa-exclamation-triangle"></i> Discontinuing a work indicates the patient abandoned treatment
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
                                        // Auto-switch to IQD if amount > 10,000 (USD amounts are typically < 10,000)
                                        const newCurrency = numericValue > 10000 ? 'IQD' : formData.currency;
                                        setFormData({...formData, total_required: numericValue, currency: newCurrency});
                                        setDisplayValues(prev => ({...prev, total_required: e.target.value}));
                                    }}
                                    onBlur={() => {
                                        setDisplayValues(prev => ({...prev, total_required: formatNumber(formData.total_required)}));
                                    }}
                                    placeholder="Enter amount (defaults to 0)"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label htmlFor="work-currency">Currency</label>
                                <select
                                    id="work-currency"
                                    value={formData.currency}
                                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, currency: e.target.value})}
                                >
                                    <option value="USD">USD</option>
                                    <option value="IQD">IQD</option>
                                    <option value="EUR">EUR</option>
                                </select>
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
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, createAsFinished: e.target.checked})}
                                        disabled={!formData.total_required || formData.total_required <= 0}
                                    />
                                    <span>
                                        <i className="fas fa-check-circle"></i> Mark as fully paid and finished
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
                                        {!isAdmin && (
                                            <small className={`${styles.formHint} ${styles.adminHint}`}>
                                                <i className="fas fa-lock"></i> Admin only
                                            </small>
                                        )}
                                    </label>
                                    <input
                                        id="work-discount"
                                        type="text"
                                        value={displayValues.discount}
                                        disabled={!isAdmin}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                            const numericValue = parseFormattedNumber(e.target.value) || 0;
                                            setFormData({ ...formData, discount: numericValue });
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
                                            <i className="fas fa-exclamation-triangle"></i> Discount cannot exceed Total Required minus Total Paid ({formatNumber(formData.total_required - existingTotalPaid)} {formData.currency})
                                        </small>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="work-discount-date">Discount Date</label>
                                    <input
                                        id="work-discount-date"
                                        type="date"
                                        value={formData.discount_date}
                                        disabled={!isAdmin || formData.discount <= 0}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, discount_date: e.target.value })}
                                    />
                                    {isAdmin && formData.discount > 0 && !formData.discount_date && (
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
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, discount_reason: e.target.value })}
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
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, start_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-estimated-duration">Estimated Duration (months)</label>
                            <input
                                id="work-estimated-duration"
                                type="number"
                                value={formData.estimated_duration}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, estimated_duration: e.target.value})}
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
                            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setFormData({...formData, notes: e.target.value})}
                            rows={3}
                            placeholder="Additional notes about this work..."
                        />
                    </div>
                </div>

                {/* Tab 2: Dates */}
                <div className={`${styles.tabContent} ${activeTab === 'dates' ? styles.tabContentActive : ''}`}>
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="work-i-photo-date">Initial Photo Date</label>
                            <input
                                id="work-i-photo-date"
                                type="date"
                                value={formData.i_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, i_photo_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-f-photo-date">Final Photo Date</label>
                            <input
                                id="work-f-photo-date"
                                type="date"
                                value={formData.f_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, f_photo_date: e.target.value})}
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
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, debond_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="work-notes-date">Notes Date</label>
                            <input
                                id="work-notes-date"
                                type="date"
                                value={formData.notes_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, notes_date: e.target.value})}
                            />
                        </div>
                    </div>
                </div>

                {/* Tab 3: Keywords */}
                <div className={`${styles.tabContent} ${activeTab === 'keywords' ? styles.tabContentActive : ''}`}>
                    <div className={styles.keywordsSection}>
                        <p className={styles.sectionHint}>
                            <i className="fas fa-info-circle"></i> Select up to 5 keywords to categorize this work
                        </p>
                        <div className={styles.keywordsGrid}>
                            {([1, 2, 3, 4, 5] as const).map(num => {
                                // Get the keyword field value with proper type handling
                                const keywordField = `keyword_id_${num}` as keyof WorkFormData;
                                const keywordValue = String(formData[keywordField] || '');
                                return (
                                <div key={num} className={styles.formGroup}>
                                    <label>Keyword {num}</label>
                                    <select
                                        value={keywordValue}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                                            const field = `keyword_id_${num}`;
                                            setFormData({...formData, [field]: e.target.value});
                                        }}
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
                    </div>
                </div>

                {/* Bottom Form Actions */}
                <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update Work' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewWorkComponent;
