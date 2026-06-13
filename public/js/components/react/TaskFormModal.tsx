import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, putJSON, httpErrorMessage } from '@/core/http';
import { createTask, fetchAssignableStaff, notifyTasksChanged, type StaffOption, type TaskRow } from '@/services/tasks';
import * as patientContract from '@shared/contracts/patient.contract';
import * as lookupContract from '@shared/contracts/lookup.contract';
import Modal from './Modal';
import styles from './TaskFormModal.module.css';

interface AlertType {
    alert_type_id: number;
    type_name: string;
}

interface PatientPick {
    person_id: number;
    patient_name: string;
}

interface TaskFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called after a successful save (the bell refetches). */
    onSaved: () => void;
    /** When set, the modal edits this task instead of creating a new one. */
    editTask?: TaskRow | null;
}

const SEVERITIES: Array<{ value: string; label: string; cls: string }> = [
    { value: '1', label: 'Mild', cls: styles.sev1 },
    { value: '2', label: 'Moderate', cls: styles.sev2 },
    { value: '3', label: 'Severe', cls: styles.sev3 },
];

/**
 * TaskFormModal — create or edit a header task (the push surface of `alerts`).
 * Create posts to /api/tasks; edit PUTs /api/alerts/:id. The optional patient link
 * (create only) is a small typeahead: a numeric query resolves a single patient by
 * id, text queries search by name.
 */
const TaskFormModal = ({ isOpen, onClose, onSaved, editTask }: TaskFormModalProps) => {
    const toast = useToast();
    const isEdit = !!editTask;

    const [details, setDetails] = useState('');
    const [severity, setSeverity] = useState('2');
    const [alertTypeId, setAlertTypeId] = useState('');
    const [assignedTo, setAssignedTo] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [snoozedUntil, setSnoozedUntil] = useState('');
    const [patient, setPatient] = useState<PatientPick | null>(null);
    const [loading, setLoading] = useState(false);
    const [alertTypes, setAlertTypes] = useState<AlertType[]>([]);
    const [staff, setStaff] = useState<StaffOption[]>([]);

    // Patient typeahead state (create mode only)
    const [pickerQuery, setPickerQuery] = useState('');
    const [pickerResults, setPickerResults] = useState<PatientPick[]>([]);
    const searchAbortRef = useRef<AbortController | null>(null);

    // Load alert types + assignable staff once when first opened.
    useEffect(() => {
        if (!isOpen) return;
        fetchJSON<AlertType[]>('/api/alert-types', { schema: lookupContract.alertTypes.response })
            .then(setAlertTypes)
            .catch(() => { /* dropdown just stays empty */ });
        fetchAssignableStaff()
            .then(setStaff)
            .catch(() => { /* picker just stays empty */ });
    }, [isOpen]);

    // Populate (edit) or reset (close) the form.
    useEffect(() => {
        if (isOpen && editTask) {
            setDetails(editTask.alert_details ?? '');
            setSeverity(String(editTask.alert_severity ?? 2));
            setAlertTypeId(editTask.alert_type_id ? String(editTask.alert_type_id) : '');
            setAssignedTo(editTask.assigned_to != null ? String(editTask.assigned_to) : '');
            setExpiresAt(editTask.expires_at ?? '');
            setSnoozedUntil('');
            setPatient(
                editTask.person_id != null
                    ? { person_id: editTask.person_id, patient_name: editTask.patient_name ?? `#${editTask.person_id}` }
                    : null
            );
            setPickerQuery('');
            setPickerResults([]);
        } else if (!isOpen) {
            setDetails('');
            setSeverity('2');
            setAlertTypeId('');
            setAssignedTo('');
            setExpiresAt('');
            setSnoozedUntil('');
            setPatient(null);
            setPickerQuery('');
            setPickerResults([]);
        }
    }, [isOpen, editTask]);

    // Debounced patient search: numeric → resolve by id, text → search by name.
    useEffect(() => {
        if (isEdit) return;
        const q = pickerQuery.trim();
        if (!q || patient) {
            setPickerResults([]);
            return;
        }
        const handle = setTimeout(() => {
            searchAbortRef.current?.abort();
            const controller = new AbortController();
            searchAbortRef.current = controller;

            if (/^\d+$/.test(q)) {
                fetchJSON<{ person_id?: number; patient_name?: string }>(
                    `/api/patients/${q}/info`,
                    { signal: controller.signal, schema: patientContract.patientInfo.response }
                )
                    .then((p) => setPickerResults(p?.person_id ? [{ person_id: p.person_id, patient_name: p.patient_name ?? `#${p.person_id}` }] : []))
                    .catch((e) => { if (e instanceof Error && e.name !== 'AbortError') setPickerResults([]); });
            } else {
                fetchJSON<{ patients: PatientPick[] }>(
                    `/api/patients/search?patientName=${encodeURIComponent(q)}&limit=8`,
                    { signal: controller.signal, schema: patientContract.patientSearch.response }
                )
                    .then((r) => setPickerResults(r.patients.slice(0, 8).map((p) => ({ person_id: p.person_id, patient_name: p.patient_name }))))
                    .catch((e) => { if (e instanceof Error && e.name !== 'AbortError') setPickerResults([]); });
            }
        }, 250);
        return () => clearTimeout(handle);
    }, [pickerQuery, patient, isEdit]);

    const handleSave = async () => {
        if (!details.trim()) {
            toast.error('Please enter the task details');
            return;
        }
        setLoading(true);
        try {
            if (isEdit && editTask) {
                await putJSON(`/api/alerts/${editTask.alert_id}`, {
                    alertTypeId: alertTypeId ? parseInt(alertTypeId, 10) : undefined,
                    alertSeverity: parseInt(severity, 10),
                    alertDetails: details.trim(),
                    surfaceMode: editTask.surface_mode,
                    expiresAt: expiresAt || '',
                    // null explicitly unassigns (updateAlert writes the provided key).
                    assignedTo: assignedTo ? parseInt(assignedTo, 10) : null,
                });
            } else {
                await createTask({
                    personId: patient?.person_id,
                    alertTypeId: alertTypeId ? parseInt(alertTypeId, 10) : undefined,
                    alertSeverity: parseInt(severity, 10),
                    alertDetails: details.trim(),
                    expiresAt: expiresAt || undefined,
                    snoozedUntil: snoozedUntil || undefined,
                    assignedTo: assignedTo ? parseInt(assignedTo, 10) : undefined,
                });
            }
            toast.success(`Task ${isEdit ? 'updated' : 'created'}`);
            notifyTasksChanged();
            onSaved();
            onClose();
        } catch (error) {
            toast.error(httpErrorMessage(error, `Failed to ${isEdit ? 'update' : 'create'} task`));
        } finally {
            setLoading(false);
        }
    };

    const handleDetails = (e: ChangeEvent<HTMLTextAreaElement>) => setDetails(e.target.value);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            contentClassName={`modal-content ${styles.dialog}`}
            ariaLabelledBy="task-modal-title"
        >
            <div className="modal-header">
                <h3 id="task-modal-title">
                    <i className="fas fa-bell" />
                    {isEdit ? ' Edit Task' : ' New Task'}
                </h3>
                <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
                    &times;
                </button>
            </div>

            <div className={`modal-body ${styles.body}`}>
                <div className="form-group">
                    <label htmlFor="task-details">Details <span className="required">*</span></label>
                    <textarea
                        id="task-details"
                        className="form-control"
                        value={details}
                        onChange={handleDetails}
                        rows={3}
                        placeholder="e.g. Call patient to come pick up his appliance"
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <span>Severity</span>
                    <div className={styles.severityRow}>
                        {SEVERITIES.map((s) => (
                            <label key={s.value} className={styles.severityOption}>
                                <input
                                    type="radio"
                                    name="task-severity"
                                    value={s.value}
                                    checked={severity === s.value}
                                    onChange={(e) => setSeverity(e.target.value)}
                                    disabled={loading}
                                />
                                <span className={`${styles.severityBadge} ${s.cls} ${severity === s.value ? styles.severityActive : ''}`}>
                                    {s.label}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Patient link — create only (the edit endpoint can't reassign the patient). */}
                {!isEdit && (
                    <div className="form-group">
                        <label htmlFor="task-patient">Link a patient <span className={styles.optional}>(optional)</span></label>
                        {patient ? (
                            <div className={styles.chip}>
                                <i className="fas fa-user" />
                                <span>{patient.patient_name} <span className={styles.chipId}>#{patient.person_id}</span></span>
                                <button type="button" className={styles.chipRemove} onClick={() => { setPatient(null); setPickerQuery(''); }} aria-label="Remove patient">
                                    &times;
                                </button>
                            </div>
                        ) : (
                            <div className={styles.picker}>
                                <input
                                    id="task-patient"
                                    type="text"
                                    className="form-control"
                                    value={pickerQuery}
                                    onChange={(e) => setPickerQuery(e.target.value)}
                                    placeholder="Search by name or patient id…"
                                    autoComplete="off"
                                    disabled={loading}
                                />
                                {pickerResults.length > 0 && (
                                    <ul className={styles.pickerDropdown} role="listbox">
                                        {pickerResults.map((p) => (
                                            <li
                                                key={p.person_id}
                                                role="option"
                                                aria-selected={false}
                                                tabIndex={0}
                                                className={styles.pickerOption}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => { setPatient(p); setPickerResults([]); }}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPatient(p); setPickerResults([]); } }}
                                            >
                                                <span>{p.patient_name}</span>
                                                <span className={styles.chipId}>#{p.person_id}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="form-group">
                    <label htmlFor="task-type">Category <span className={styles.optional}>(optional)</span></label>
                    <select
                        id="task-type"
                        className="form-control"
                        value={alertTypeId}
                        onChange={(e) => setAlertTypeId(e.target.value)}
                        disabled={loading}
                    >
                        <option value="">None</option>
                        {alertTypes.map((t) => (
                            <option key={t.alert_type_id} value={t.alert_type_id}>{t.type_name}</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="task-assignee">Assign to <span className={styles.optional}>(optional)</span></label>
                    <select
                        id="task-assignee"
                        className="form-control"
                        value={assignedTo}
                        onChange={(e) => setAssignedTo(e.target.value)}
                        disabled={loading}
                    >
                        <option value="">Anyone (unassigned)</option>
                        {staff.map((s) => (
                            <option key={s.id} value={s.id}>{s.employee_name}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.dateGrid}>
                    <div className="form-group">
                        <label htmlFor="task-expires">Expires <span className={styles.optional}>(optional)</span></label>
                        <input
                            id="task-expires"
                            type="date"
                            className="form-control"
                            value={expiresAt}
                            onChange={(e) => setExpiresAt(e.target.value)}
                            disabled={loading}
                        />
                    </div>
                    {!isEdit && (
                        <div className="form-group">
                            <label htmlFor="task-snooze">Show from <span className={styles.optional}>(optional)</span></label>
                            <input
                                id="task-snooze"
                                type="date"
                                className="form-control"
                                value={snoozedUntil}
                                onChange={(e) => setSnoozedUntil(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className={`modal-footer ${styles.footer}`}>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading}>
                    {loading ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <><i className="fas fa-save" /> {isEdit ? 'Save' : 'Create Task'}</>}
                </button>
            </div>
        </Modal>
    );
};

export default TaskFormModal;
