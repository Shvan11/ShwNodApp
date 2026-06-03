/**
 * NewWorkComponent - Standalone form for adding/editing works
 *
 * Compact, space-efficient form with keyword management
 */

import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { formatNumber, parseFormattedNumber } from '../../utils/formatters';
import { formatISODate } from '../../core/utils';
import { useGlobalState } from '../../contexts/GlobalStateContext';
import styles from './NewWorkComponent.module.css';

interface WorkType {
    id: number;
    work_type: string;
}

interface Keyword {
    id: number;
    key_word: string;
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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
    const [keywords, setKeywords] = useState<Keyword[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
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

    useEffect(() => {
        loadDropdownData();
        if (workId) {
            loadWorkData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, workId]);

    // Auto-format display value when formData changes
    useEffect(() => {
        setDisplayValues(prev => ({
            ...prev,
            total_required: formatNumber(formData.total_required)
        }));
    }, [formData.total_required]);

    useEffect(() => {
        setDisplayValues(prev => ({
            ...prev,
            discount: formData.discount ? formatNumber(formData.discount) : ''
        }));
    }, [formData.discount]);

    const loadDropdownData = async () => {
        try {
            const [typesRes, keywordsRes, employeesRes] = await Promise.all([
                fetch('/api/getworktypes'),
                fetch('/api/getworkkeywords'),
                fetch('/api/employees?percentage=true')
            ]);

            if (typesRes.ok) {
                const types: WorkType[] = await typesRes.json();
                setWorkTypes(types);
            }
            if (keywordsRes.ok) {
                const kw: Keyword[] = await keywordsRes.json();
                setKeywords(kw);
            }
            if (employeesRes.ok) {
                const data = await employeesRes.json();
                setDoctors(data?.employees || []);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    };

    const loadWorkData = async () => {
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/getworks?code=${personId}`);
            if (!response.ok) throw new Error('Failed to fetch work data');
            const works: WorkResponse[] = await response.json();
            const work = works.find(w => w.work_id === workId);

            if (work) {
                const discountDateISO = work.discount_date ? new Date(work.discount_date).toISOString().split('T')[0] : '';
                const discountValue = Number(work.discount ?? 0);
                setFormData({
                    person_id: String(work.person_id),
                    total_required: work.total_required ?? 0, // Use nullish coalescing to preserve 0
                    currency: work.currency || 'USD',
                    type_of_work: String(work.type_of_work || ''),
                    notes: work.notes || '',
                    status: work.status ?? 1, // Use nullish coalescing to preserve 0 if somehow status is 0
                    start_date: work.start_date ? new Date(work.start_date).toISOString().split('T')[0] : '',
                    debond_date: work.debond_date ? new Date(work.debond_date).toISOString().split('T')[0] : '',
                    f_photo_date: work.f_photo_date ? new Date(work.f_photo_date).toISOString().split('T')[0] : '',
                    i_photo_date: work.i_photo_date ? new Date(work.i_photo_date).toISOString().split('T')[0] : '',
                    estimated_duration: String(work.estimated_duration || ''),
                    dr_id: String(work.dr_id || ''),
                    notes_date: work.notes_date ? new Date(work.notes_date).toISOString().split('T')[0] : '',
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
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

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
            let response: Response;

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
                response = await fetch('/api/updatework', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatePayload)
                });
            } else {
                // Add new work - use special endpoint if createAsFinished is true
                // Strip discount fields from creation payload (not supported at creation)
                const { discount: _d, discount_date: _dd, discount_reason: _dr, ...creationData } = formData;
                void _d; void _dd; void _dr;
                const endpoint = formData.createAsFinished ? '/api/addWorkWithInvoice' : '/api/addwork';
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(creationData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                // Handle specific error cases with detailed messages
                // Check for DUPLICATE_ACTIVE_WORK in details.code or top-level code
                const errorCode = errorData.details?.code || errorData.code;
                if (errorCode === 'DUPLICATE_ACTIVE_WORK') {
                    // Show confirmation dialog instead of error
                    setExistingWorkData(errorData.details?.existingWork || errorData.existingWork);
                    setPendingFormData(formData);
                    setShowConfirmDialog(true);
                    setLoading(false);
                    return;
                }

                // Handle 409 Conflict - Status change conflict (Active work already exists).
                // existingWork now arrives under `details` (standard error envelope); keep the
                // top-level fallback for any older shape.
                const conflictWork = errorData.details?.existingWork || errorData.existingWork;
                if (response.status === 409 && conflictWork) {
                    const existingWork = conflictWork;
                    const errorMessage = `Cannot activate this work: Patient already has an active work:\n\n` +
                        `Work Type: ${existingWork.type || 'N/A'}\n` +
                        `Doctor: ${existingWork.doctor || 'N/A'}\n` +
                        `Work ID: ${existingWork.work_id}\n\n` +
                        `Please finish or discontinue the existing work first.`;
                    throw new Error(errorMessage);
                }

                // Extract error message properly (details.message > message > error).
                // Note: errorData.details is an object in the standard envelope, so it is NOT a
                // message fallback (that previously surfaced "[object Object]").
                const errorMessage = errorData.details?.message || errorData.message || errorData.error || 'Failed to save work';
                throw new Error(errorMessage);
            }

            const result: WorkResponse = await response.json();
            if (onSave) {
                onSave(result);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleFinishExistingAndAddNew = async () => {
        try {
            setLoading(true);
            setShowConfirmDialog(false);

            // First, finish the existing work
            const finishResponse = await fetch('/api/finishwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: existingWorkData?.workId })
            });

            if (!finishResponse.ok) {
                throw new Error('Failed to finish existing work');
            }

            // Now add the new work
            const pendingCreation = pendingFormData
                ? (() => {
                      const { discount: _d, discount_date: _dd, discount_reason: _dr, ...rest } = pendingFormData;
                      void _d; void _dd; void _dr;
                      return rest;
                  })()
                : pendingFormData;
            const addResponse = await fetch('/api/addwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pendingCreation)
            });

            if (!addResponse.ok) {
                const errorData = await addResponse.json();
                throw new Error(errorData.details || errorData.error || 'Failed to add new work');
            }

            const result: WorkResponse = await addResponse.json();
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

    if (loading && workId) {
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
                <div className={styles.confirmationDialogOverlay}>
                    <div className={styles.confirmationDialog}>
                        <div className={styles.confirmationHeader}>
                            <i className="fas fa-exclamation-triangle"></i>
                            <h3>Active Work Already Exists</h3>
                        </div>
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
                    </div>
                </div>
            )}

            {/* Confirmation Dialog for Finished Work with Invoice */}
            {showFinishedWorkConfirm && (
                <div className={styles.confirmationDialogOverlay}>
                    <div className={styles.confirmationDialog}>
                        <div className={styles.confirmationHeader}>
                            <i className="fas fa-check-circle"></i>
                            <h3>Confirm Completed Work Creation</h3>
                        </div>
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
                    </div>
                </div>
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
                            <label>Work Type <span className={styles.required}>*</span></label>
                            <select
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
                            <label>Doctor <span className={styles.required}>*</span></label>
                            <select
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
                                <label>Status <span className={styles.required}>*</span></label>
                                <select
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

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label>Total Required</label>
                            <input
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
                            <label>Currency</label>
                            <select
                                value={formData.currency}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({...formData, currency: e.target.value})}
                            >
                                <option value="USD">USD</option>
                                <option value="IQD">IQD</option>
                                <option value="EUR">EUR</option>
                            </select>
                        </div>
                    </div>

                    {!workId && (
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
                                    <label>
                                        Discount
                                        {!isAdmin && (
                                            <small className={styles.formHint} style={{ marginLeft: 8 }}>
                                                <i className="fas fa-lock"></i> Admin only
                                            </small>
                                        )}
                                    </label>
                                    <input
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
                                    <label>Discount Date</label>
                                    <input
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
                                <label>Discount Reason <small style={{ fontWeight: 'normal', opacity: 0.7 }}>(optional)</small></label>
                                <textarea
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
                            <label>Start Date</label>
                            <input
                                type="date"
                                value={formData.start_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, start_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label>Estimated Duration (months)</label>
                            <input
                                type="number"
                                value={formData.estimated_duration}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, estimated_duration: e.target.value})}
                                min="1"
                                max="255"
                            />
                        </div>
                    </div>

                    <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                        <label>Notes</label>
                        <textarea
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
                            <label>Initial Photo Date</label>
                            <input
                                type="date"
                                value={formData.i_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, i_photo_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label>Final Photo Date</label>
                            <input
                                type="date"
                                value={formData.f_photo_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, f_photo_date: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label>Debond Date</label>
                            <input
                                type="date"
                                value={formData.debond_date}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({...formData, debond_date: e.target.value})}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label>Notes Date</label>
                            <input
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
