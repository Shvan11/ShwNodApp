import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import styles from './AlignerDoctorsSettings.module.css';

interface AlignerDoctor {
    DrID: number;
    DoctorName: string;
    DoctorEmail: string | null;
    LogoPath: string | null;
}

interface FormData {
    DoctorName: string;
    DoctorEmail: string;
    LogoPath: string;
}

interface AlignerDoctorsSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

const AlignerDoctorsSettings = ({ onChangesUpdate }: AlignerDoctorsSettingsProps) => {
    const toast = useToast();
    const [doctors, setDoctors] = useState<AlignerDoctor[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState<FormData>({
        DoctorName: '',
        DoctorEmail: '',
        LogoPath: ''
    });

    // Load doctors on component mount
    useEffect(() => {
        loadDoctors();
    }, []);

    const loadDoctors = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/aligner-doctors');

            if (!response.ok) {
                throw new Error('Failed to load doctors');
            }

            const data = await response.json();
            setDoctors(data.doctors || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = () => {
        setFormData({ DoctorName: '', DoctorEmail: '', LogoPath: '' });
        setEditingId(null);
        setShowAddForm(true);
    };

    const handleEdit = (doctor: AlignerDoctor) => {
        setFormData({
            DoctorName: doctor.DoctorName || '',
            DoctorEmail: doctor.DoctorEmail || '',
            LogoPath: doctor.LogoPath || ''
        });
        setEditingId(doctor.DrID);
        setShowAddForm(true);
    };

    const handleCancel = () => {
        setFormData({ DoctorName: '', DoctorEmail: '', LogoPath: '' });
        setEditingId(null);
        setShowAddForm(false);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        try {
            const url = editingId
                ? `/api/aligner-doctors/${editingId}`
                : '/api/aligner-doctors';

            const method = editingId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save doctor');
            }

            await loadDoctors();
            handleCancel();

            // Show success message
            toast.success(editingId ? 'Doctor updated successfully!' : 'Doctor added successfully!');
        } catch (err) {
            console.error('Error saving doctor:', err);
            toast.error((err as Error).message);
        }
    };

    const handleDelete = async (drID: number, doctorName: string) => {
        if (!confirm(`Are you sure you want to delete ${doctorName}? This will affect all their aligner cases.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/aligner-doctors/${drID}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete doctor');
            }

            await loadDoctors();
            toast.success('Doctor deleted successfully!');
        } catch (err) {
            console.error('Error deleting doctor:', err);
            toast.error((err as Error).message);
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
                                name="DoctorName"
                                value={formData.DoctorName}
                                onChange={handleInputChange}
                                required
                                placeholder="e.g., Dr. John Smith"
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
                                name="DoctorEmail"
                                value={formData.DoctorEmail}
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
                                name="LogoPath"
                                value={formData.LogoPath}
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
                                    <tr key={doctor.DrID}>
                                        <td>{doctor.DrID}</td>
                                        <td className={styles.doctorName}>
                                            <i className="fas fa-user-md"></i>
                                            {doctor.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor.DoctorName}`}
                                        </td>
                                        <td>
                                            {doctor.DoctorEmail ? (
                                                <span className={styles.emailValue}>
                                                    <i className="fas fa-envelope"></i>
                                                    {doctor.DoctorEmail}
                                                </span>
                                            ) : (
                                                <span className={styles.noEmail}>No email</span>
                                            )}
                                        </td>
                                        <td>
                                            {doctor.DoctorEmail ? (
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
                                            {doctor.LogoPath || <span className={styles.textMuted}>—</span>}
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
                                                onClick={() => handleDelete(doctor.DrID, doctor.DoctorName)}
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
