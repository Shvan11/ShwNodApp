import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { putJSON, httpErrorMessage } from '@/core/http';
import { alertTypesQuery, employeesQuery } from '@/query/queries';
import { usePatientLookup } from '@/hooks/usePatientLookup';
import { uniquePatients } from '@/utils/patientSearch';
import { createTask, invalidateTasks, type StaffOption, type TaskRow } from '@/services/tasks';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
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
    /** When set, the modal edits this task instead of creating a new one. */
    editTask?: TaskRow | null;
}

const SEVERITIES = [
    { value: '1', label: 'mild', cls: styles.sev1 },
    { value: '2', label: 'moderate', cls: styles.sev2 },
    { value: '3', label: 'severe', cls: styles.sev3 },
] as const;

/**
 * TaskFormModal — create or edit a header task (the push surface of `alerts`).
 * Create posts to /api/tasks; edit PUTs /api/alerts/:id. The optional patient link
 * (create only) is the app's patient typeahead (`usePatientLookup`): a name, or —
 * when the text starts with a digit — a patient id or phone number.
 */
const TaskFormModal = ({ isOpen, onClose, editTask }: TaskFormModalProps) => {
    const { t } = useTranslation('tasks');
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

    // Alert-type dropdown + assignable-staff picker — loaded when the modal is open.
    const { data: alertTypesData } = useQuery({ ...alertTypesQuery(), enabled: isOpen });
    const alertTypes: AlertType[] = alertTypesData ?? [];
    const { data: employeesData } = useQuery({ ...employeesQuery(), enabled: isOpen });
    const staff: StaffOption[] = employeesData?.employees ?? [];
    // The picker lists active staff only; a task still assigned to someone who has
    // since left keeps them (the server allows keeping an existing assignment), so
    // show them by name rather than as "Anyone" over a value no option has (FE-F5-5).
    const formerAssignee =
        editTask?.assigned_to != null && !staff.some((s) => s.id === editTask.assigned_to)
            ? { id: editTask.assigned_to, name: editTask.assignee_name ?? `#${editTask.assigned_to}` }
            : null;

    // Patient typeahead (create mode only). It asks nothing once a patient is picked.
    const [pickerQuery, setPickerQuery] = useState('');
    const lookup = usePatientLookup(pickerQuery, { by: 'auto', enabled: isOpen && !isEdit && !patient });
    const pickerResults: PatientPick[] = uniquePatients(lookup.matches).map((m) => ({
        person_id: m.id,
        patient_name: m.name,
    }));

    // Populate (edit) or reset (close) the form. Done during render (keyed on open +
    // edit-target identity) rather than in an effect, so the React Compiler can
    // optimize and there's no extra post-paint render.
    const initKey = isOpen ? String(editTask?.alert_id ?? 'new') : '';
    const [initializedKey, setInitializedKey] = useState('');
    if (initKey !== initializedKey) {
        setInitializedKey(initKey);
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
        } else if (!isOpen) {
            setDetails('');
            setSeverity('2');
            setAlertTypeId('');
            setAssignedTo('');
            setExpiresAt('');
            setSnoozedUntil('');
            setPatient(null);
            setPickerQuery('');
        }
    }

    const handleSave = async () => {
        if (!details.trim()) {
            toast.error(t('form.detailsRequired'));
            return;
        }
        setLoading(true);
        try {
            if (isEdit && editTask) {
                await putJSON(`/api/alerts/${editTask.alert_id}`, {
                    // null clears the category; omitting it would keep the old one (FE-F5-5).
                    alertTypeId: alertTypeId ? parseInt(alertTypeId, 10) : null,
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
            toast.success(isEdit ? t('form.updated') : t('form.created'));
            void invalidateTasks(isEdit ? editTask?.person_id : patient?.person_id);
            onClose();
        } catch (error) {
            toast.error(httpErrorMessage(error, isEdit ? t('form.updateFailed') : t('form.createFailed')));
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
            unsavedGuard={{ watchInput: true }}
        >
            {(dismiss) => (<>
            <ModalHeader
                titleId="task-modal-title"
                icon={<i className="fas fa-bell" aria-hidden="true" />}
                title={isEdit ? t('form.editTitle') : t('form.newTitle')}
                onClose={dismiss}
            />

            <div className={`modal-body ${styles.body}`}>
                <div className="form-group">
                    <label htmlFor="task-details">{t('form.details')} <span className="required">*</span></label>
                    <textarea
                        id="task-details"
                        className="form-control"
                        value={details}
                        onChange={handleDetails}
                        rows={3}
                        placeholder={t('form.detailsPlaceholder')}
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <span>{t('form.severity')}</span>
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
                                    {t(`severity.${s.label}`)}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Patient link — create only (the edit endpoint can't reassign the patient). */}
                {!isEdit && (
                    <div className="form-group">
                        <label htmlFor="task-patient">{t('form.linkPatient')} <span className={styles.optional}>{t('form.optional')}</span></label>
                        {patient ? (
                            <div className={styles.chip}>
                                <i className="fas fa-user" aria-hidden="true" />
                                <span>{patient.patient_name} <span className={styles.chipId}>#{patient.person_id}</span></span>
                                <button type="button" className={styles.chipRemove} onClick={() => { setPatient(null); setPickerQuery(''); }} aria-label={t('form.removePatient')}>
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
                                    placeholder={t('form.searchPatient')}
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
                                                onClick={() => setPatient(p)}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPatient(p); } }}
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
                    <label htmlFor="task-type">{t('form.category')} <span className={styles.optional}>{t('form.optional')}</span></label>
                    <select
                        id="task-type"
                        className="form-control"
                        value={alertTypeId}
                        onChange={(e) => setAlertTypeId(e.target.value)}
                        disabled={loading}
                    >
                        <option value="">{t('form.none')}</option>
                        {alertTypes.map((t) => (
                            <option key={t.alert_type_id} value={t.alert_type_id}>{t.type_name}</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label htmlFor="task-assignee">{t('form.assignTo')} <span className={styles.optional}>{t('form.optional')}</span></label>
                    <select
                        id="task-assignee"
                        className="form-control"
                        value={assignedTo}
                        onChange={(e) => setAssignedTo(e.target.value)}
                        disabled={loading}
                    >
                        <option value="">{t('form.anyone')}</option>
                        {formerAssignee && (
                            <option value={formerAssignee.id}>{t('form.formerStaff', { name: formerAssignee.name })}</option>
                        )}
                        {staff.map((s) => (
                            <option key={s.id} value={s.id}>{s.employee_name}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.dateGrid}>
                    <div className="form-group">
                        <label htmlFor="task-expires">{t('form.expires')} <span className={styles.optional}>{t('form.optional')}</span></label>
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
                            <label htmlFor="task-snooze">{t('form.showFrom')} <span className={styles.optional}>{t('form.optional')}</span></label>
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
                <button type="button" className="btn btn-secondary" onClick={dismiss} disabled={loading}>{t('form.cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading}>
                    {loading
                        ? <><i className="fas fa-spinner fa-spin" aria-hidden="true" /> {t('form.saving')}</>
                        : <><i className="fas fa-save" aria-hidden="true" /> {isEdit ? t('form.save') : t('form.create')}</>}
                </button>
            </div>
            </>)}
        </Modal>
    );
};

export default TaskFormModal;
