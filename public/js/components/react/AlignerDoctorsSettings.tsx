import { useState, ChangeEvent, FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { alignerDoctorsAdminQuery, alignerFeaturesQuery } from '@/query/queries';
import { invalidateAligner } from '@/query/aligner';
import { doctorLabel } from '../../utils/aligner-labels';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './AlignerDoctorsSettings.module.css';
import type { AlignerDoctor } from '../../pages/aligner/aligner.types';

/**
 * What the form edits. No logo path: the doctor body never carried one (the contract
 * strips it), so the old free-text field — with this clinic's `C:\Aligner_Sets\…`
 * placeholder — saved nothing, and the label PDF doesn't read it either (F20's
 * question). The stored path is shown read-only in the table.
 */
interface FormData {
    doctor_name: string;
    doctor_email: string;
}

const EMPTY_FORM: FormData = { doctor_name: '', doctor_email: '' };

interface AlignerDoctorsSettingsProps {
    /** The Settings shell passes it to every tab; this tab saves per action, so it has nothing to report. */
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const AlignerDoctorsSettings = (_props: AlignerDoctorsSettingsProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const { data, isLoading: loading, error: queryError, refetch } = useQuery(alignerDoctorsAdminQuery());
    const doctors = data?.doctors ?? [];
    const error = queryError ? httpErrorMessage(queryError, 'Failed to load doctors') : null;
    // Portal access means something only on an install with a doctor portal (FE-F18-12).
    const hasPortal = useQuery(alignerFeaturesQuery()).data?.portal ?? false;
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
    // One save at a time: a double click on "Add Doctor" created two doctors (FE-F18-9).
    const [saving, setSaving] = useState(false);

    const handleAdd = () => {
        setFormData(EMPTY_FORM);
        setEditingId(null);
        setShowAddForm(true);
    };

    const handleEdit = (doctor: AlignerDoctor) => {
        setFormData({
            doctor_name: doctor.doctor_name || '',
            doctor_email: doctor.doctor_email || '',
        });
        setEditingId(doctor.dr_id);
        setShowAddForm(true);
    };

    const handleCancel = () => {
        setFormData(EMPTY_FORM);
        setEditingId(null);
        setShowAddForm(false);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
            const url = editingId
                ? `/api/aligner-doctors/${editingId}`
                : '/api/aligner-doctors';

            await (editingId ? putJSON(url, formData) : postJSON(url, formData));

            // Every aligner read: the Browse-by-Doctor cards, a patient list's header,
            // the announcement audience and All Sets show doctor names too (FE-F18-10).
            await invalidateAligner();
            handleCancel();
            toast.success(editingId ? 'Doctor updated successfully!' : 'Doctor added successfully!');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save doctor'));
        } finally {
            setSaving(false);
        }
    };

    // Say what a delete really does (FE-F18-10): it is refused while the doctor has
    // sets, and what it removes is the announcements addressed to them.
    const handleDelete = async (drID: number, doctorName: string) => {
        const ok = await confirm(
            `Delete ${doctorLabel(doctorName)}?\n` +
                'A doctor who still has aligner sets cannot be deleted — reassign or delete those sets first.\n' +
                (hasPortal ? 'Deleting also removes the portal announcements addressed to this doctor, and their read receipts.' : ''),
            { title: 'Delete Doctor', danger: true, confirmText: 'Delete' }
        );
        if (!ok) return;

        try {
            await deleteJSON(`/api/aligner-doctors/${drID}`);
            await invalidateAligner();
            toast.success('Doctor deleted successfully!');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete doctor'));
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading doctors...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer}>
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>Error: {error}</p>
                    <button onClick={() => refetch()} className={styles.btnRetry}>
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.sectionHeader}>
                <div className={styles.headerContent}>
                    <h2>
                        <i className="fas fa-user-md"></i>
                        Aligner Doctors
                    </h2>
                    <p className={styles.sectionDescription}>
                        Manage doctors who can access the aligner portal and their contact information
                    </p>
                </div>
                <button
                    className={styles.btnAdd}
                    onClick={handleAdd}
                    disabled={showAddForm}
                >
                    <i className="fas fa-plus"></i>
                    Add Doctor
                </button>
            </div>

            {/* Escape / backdrop / ✕ / Cancel ask before dropping a typed form (FE-F18-9). */}
            <Modal
                isOpen={showAddForm}
                onClose={handleCancel}
                contentClassName={styles.modal}
                ariaLabelledBy="aligner-doctor-modal-title"
                unsavedGuard={{ watchInput: true }}
            >
                {(dismiss) => (<>
                <ModalHeader
                    titleId="aligner-doctor-modal-title"
                    icon={<i className={editingId ? 'fas fa-edit' : 'fas fa-plus'} />}
                    title={editingId ? 'Edit Doctor' : 'Add New Doctor'}
                    onClose={dismiss}
                />
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.modalBody}>
                        <div className={styles.formGroup}>
                            <label htmlFor="DoctorName">
                                Doctor Name <span className={styles.required}>*</span>
                            </label>
                            <input
                                type="text"
                                id="DoctorName"
                                name="doctor_name"
                                value={formData.doctor_name}
                                onChange={handleInputChange}
                                required
                                placeholder="e.g., Ahmad (without Dr. prefix)"
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="DoctorEmail">
                                Email Address
                                {hasPortal && (
                                    <span className={styles.fieldHelp}>
                                        (The address the doctor signs in to the portal with)
                                    </span>
                                )}
                            </label>
                            <input
                                type="email"
                                id="DoctorEmail"
                                name="doctor_email"
                                value={formData.doctor_email}
                                onChange={handleInputChange}
                                placeholder="doctor@example.com"
                            />
                        </div>

                    </div>

                    <div className={styles.modalFooter}>
                        <button type="button" onClick={dismiss} className={styles.btnCancel} disabled={saving}>
                            <i className="fas fa-times" aria-hidden="true"></i>
                            Cancel
                        </button>
                        <button type="submit" className={styles.btnSave} disabled={saving}>
                            <i className={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'} aria-hidden="true"></i>
                            {editingId ? 'Update Doctor' : 'Add Doctor'}
                        </button>
                    </div>
                </form>
                </>)}
            </Modal>

            <div className={styles.list}>
                {doctors.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-user-md"></i>
                        <p>No doctors found</p>
                        <p className={styles.emptyStateHint}>Click "Add Doctor" to create your first doctor entry</p>
                    </div>
                ) : (
                    <div className={styles.tableContainer}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Doctor Name</th>
                                    <th>Email</th>
                                    {hasPortal && <th>Portal Sign-in</th>}
                                    <th>Logo Path</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {doctors.map(doctor => (
                                    <tr key={doctor.dr_id}>
                                        <td>{doctor.dr_id}</td>
                                        <td className={styles.doctorName}>
                                            <i className="fas fa-user-md"></i>
                                            {doctorLabel(doctor.doctor_name)}
                                        </td>
                                        <td>
                                            {doctor.doctor_email ? (
                                                <span className={styles.emailValue}>
                                                    <i className="fas fa-envelope"></i>
                                                    {doctor.doctor_email}
                                                </span>
                                            ) : (
                                                <span className={styles.noEmail}>No email</span>
                                            )}
                                        </td>
                                        {/* "Has an email" is all this can know — the portal signs a
                                            doctor in by it (it said "Enabled", FE-F18-10). */}
                                        {hasPortal && (
                                            <td>
                                                {doctor.doctor_email ? (
                                                    <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                                                        <i className="fas fa-check-circle" aria-hidden="true"></i>
                                                        By email
                                                    </span>
                                                ) : (
                                                    <span className={`${styles.badge} ${styles.badgeWarning}`}>
                                                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                                                        No email
                                                    </span>
                                                )}
                                            </td>
                                        )}
                                        <td className={styles.logoPath}>
                                            {doctor.logo_path || <span className={styles.textMuted}>—</span>}
                                        </td>
                                        <td className={styles.actions}>
                                            <button
                                                type="button"
                                                className={`${styles.btnIcon} ${styles.btnEdit}`}
                                                onClick={() => handleEdit(doctor)}
                                                title="Edit doctor"
                                                aria-label={`Edit ${doctorLabel(doctor.doctor_name)}`}
                                            >
                                                <i className="fas fa-edit" aria-hidden="true"></i>
                                            </button>
                                            <button
                                                type="button"
                                                className={`${styles.btnIcon} ${styles.btnDelete}`}
                                                onClick={() => void handleDelete(doctor.dr_id, doctor.doctor_name)}
                                                title="Delete doctor"
                                                aria-label={`Delete ${doctorLabel(doctor.doctor_name)}`}
                                            >
                                                <i className="fas fa-trash" aria-hidden="true"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AlignerDoctorsSettings;
