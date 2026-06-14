import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './AlignerDoctorsSettings.module.css';
import type { AlignerDoctor } from '../../pages/aligner/aligner.types';

interface FormData {
    doctor_name: string;
    doctor_email: string;
    logo_path: string;
}

interface AlignerDoctorsSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const AlignerDoctorsSettings = ({ onChangesUpdate: _onChangesUpdate }: AlignerDoctorsSettingsProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const [doctors, setDoctors] = useState<AlignerDoctor[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<FormData>({
        doctor_name: '',
        doctor_email: '',
        logo_path: ''
    });

    const loadDoctors = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchJSON<{ doctors?: AlignerDoctor[] }>('/api/aligner-doctors', { schema: alignerContract.doctorsList.response });
            setDoctors(data.doctors || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
            setError(httpErrorMessage(err, 'Failed to load doctors'));
        } finally {
            setLoading(false);
        }
    };

    // Load doctors on component mount
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot data fetch on mount; loader's setState is intentional
        loadDoctors();
    }, []);

    const handleAdd = () => {
        setFormData({ doctor_name: '', doctor_email: '', logo_path: '' });
        setEditingId(null);
        setShowAddForm(true);
    };

    const handleEdit = (doctor: AlignerDoctor) => {
        setFormData({
            doctor_name: doctor.doctor_name || '',
            doctor_email: doctor.doctor_email || '',
            logo_path: doctor.logo_path || ''
        });
        setEditingId(doctor.dr_id);
        setShowAddForm(true);
    };

    const handleCancel = () => {
        setFormData({ doctor_name: '', doctor_email: '', logo_path: '' });
        setEditingId(null);
        setShowAddForm(false);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        try {
            const url = editingId
                ? `/api/aligner-doctors/${editingId}`
                : '/api/aligner-doctors';

            await (editingId ? putJSON(url, formData) : postJSON(url, formData));

            await loadDoctors();
            handleCancel();

            // Show success message
            toast.success(editingId ? 'Doctor updated successfully!' : 'Doctor added successfully!');
        } catch (err) {
            console.error('Error saving doctor:', err);
            toast.error(httpErrorMessage(err, 'Failed to save doctor'));
        }
    };

    const handleDelete = async (drID: number, doctorName: string) => {
        if (!await confirm(`Are you sure you want to delete ${doctorName}? This will affect all their aligner cases.`, { title: 'Delete Doctor', danger: true, confirmText: 'Delete' })) {
            return;
        }

        try {
            await deleteJSON(`/api/aligner-doctors/${drID}`);

            await loadDoctors();
            toast.success('Doctor deleted successfully!');
        } catch (err) {
            console.error('Error deleting doctor:', err);
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
                    <button onClick={loadDoctors} className={styles.btnRetry}>
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

            {showAddForm && (
                <div className={styles.formContainer}>
                    <div className={styles.formHeader}>
                        <h3>
                            <i className={editingId ? 'fas fa-edit' : 'fas fa-plus'}></i>
                            {editingId ? 'Edit Doctor' : 'Add New Doctor'}
                        </h3>
                    </div>
                    <form onSubmit={handleSubmit} className={styles.form}>
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
                                <span className={styles.fieldHelp}>
                                    (Required for portal access)
                                </span>
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

                        <div className={styles.formGroup}>
                            <label htmlFor="LogoPath">
                                Logo Path
                                <span className={styles.fieldHelp}>
                                    (Optional - path to doctor's logo image)
                                </span>
                            </label>
                            <input
                                type="text"
                                id="LogoPath"
                                name="logo_path"
                                value={formData.logo_path}
                                onChange={handleInputChange}
                                placeholder="C:\Aligner_Sets\Labels\logo.png"
                            />
                        </div>

                        <div className={styles.formActions}>
                            <button type="button" onClick={handleCancel} className={styles.btnCancel}>
                                <i className="fas fa-times"></i>
                                Cancel
                            </button>
                            <button type="submit" className={styles.btnSave}>
                                <i className="fas fa-save"></i>
                                {editingId ? 'Update Doctor' : 'Add Doctor'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

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
                                    <th>Portal Access</th>
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
                                            {doctor.doctor_name === 'Admin' ? doctor.doctor_name : `Dr. ${doctor.doctor_name}`}
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
                                        <td>
                                            {doctor.doctor_email ? (
                                                <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                                                    <i className="fas fa-check-circle"></i>
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className={`${styles.badge} ${styles.badgeWarning}`}>
                                                    <i className="fas fa-exclamation-triangle"></i>
                                                    No Access
                                                </span>
                                            )}
                                        </td>
                                        <td className={styles.logoPath}>
                                            {doctor.logo_path || <span className={styles.textMuted}>—</span>}
                                        </td>
                                        <td className={styles.actions}>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnEdit}`}
                                                onClick={() => handleEdit(doctor)}
                                                title="Edit doctor"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnDelete}`}
                                                onClick={() => handleDelete(doctor.dr_id, doctor.doctor_name)}
                                                title="Delete doctor"
                                            >
                                                <i className="fas fa-trash"></i>
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
