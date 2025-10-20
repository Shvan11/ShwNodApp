import React, { useState, useEffect } from 'react';

const AlignerDoctorsSettings = ({ onChangesUpdate }) => {
    const [doctors, setDoctors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [formData, setFormData] = useState({
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
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = () => {
        setFormData({ DoctorName: '', DoctorEmail: '', LogoPath: '' });
        setEditingId(null);
        setShowAddForm(true);
    };

    const handleEdit = (doctor) => {
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

    const handleSubmit = async (e) => {
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
            alert(editingId ? 'Doctor updated successfully!' : 'Doctor added successfully!');
        } catch (err) {
            console.error('Error saving doctor:', err);
            alert(err.message);
        }
    };

    const handleDelete = async (drID, doctorName) => {
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
            alert('Doctor deleted successfully!');
        } catch (err) {
            console.error('Error deleting doctor:', err);
            alert(err.message);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    if (loading) {
        return (
            <div className="settings-section">
                <div className="loading-container">
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading doctors...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="settings-section">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle"></i>
                    <p>Error: {error}</p>
                    <button onClick={loadDoctors} className="btn-retry">
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="settings-section aligner-doctors-settings">
            <div className="section-header">
                <div className="header-content">
                    <h2>
                        <i className="fas fa-user-md"></i>
                        Aligner Doctors
                    </h2>
                    <p className="section-description">
                        Manage doctors who can access the aligner portal and their contact information
                    </p>
                </div>
                <button
                    className="btn-add-doctor"
                    onClick={handleAdd}
                    disabled={showAddForm}
                >
                    <i className="fas fa-plus"></i>
                    Add Doctor
                </button>
            </div>

            {showAddForm && (
                <div className="doctor-form-container">
                    <div className="form-header">
                        <h3>
                            <i className={editingId ? 'fas fa-edit' : 'fas fa-plus'}></i>
                            {editingId ? 'Edit Doctor' : 'Add New Doctor'}
                        </h3>
                    </div>
                    <form onSubmit={handleSubmit} className="doctor-form">
                        <div className="form-group">
                            <label htmlFor="DoctorName">
                                Doctor Name <span className="required">*</span>
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

                        <div className="form-group">
                            <label htmlFor="DoctorEmail">
                                Email Address
                                <span className="field-help">
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

                        <div className="form-group">
                            <label htmlFor="LogoPath">
                                Logo Path
                                <span className="field-help">
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

                        <div className="form-actions">
                            <button type="button" onClick={handleCancel} className="btn-cancel">
                                <i className="fas fa-times"></i>
                                Cancel
                            </button>
                            <button type="submit" className="btn-save">
                                <i className="fas fa-save"></i>
                                {editingId ? 'Update Doctor' : 'Add Doctor'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="doctors-list">
                {doctors.length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-user-md"></i>
                        <p>No doctors found</p>
                        <p className="empty-state-hint">Click "Add Doctor" to create your first doctor entry</p>
                    </div>
                ) : (
                    <div className="doctors-table-container">
                        <table className="doctors-table">
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
                                        <td className="doctor-name">
                                            <i className="fas fa-user-md"></i>
                                            {doctor.DoctorName}
                                        </td>
                                        <td>
                                            {doctor.DoctorEmail ? (
                                                <span className="email-value">
                                                    <i className="fas fa-envelope"></i>
                                                    {doctor.DoctorEmail}
                                                </span>
                                            ) : (
                                                <span className="no-email">No email</span>
                                            )}
                                        </td>
                                        <td>
                                            {doctor.DoctorEmail ? (
                                                <span className="badge badge-success">
                                                    <i className="fas fa-check-circle"></i>
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className="badge badge-warning">
                                                    <i className="fas fa-exclamation-triangle"></i>
                                                    No Access
                                                </span>
                                            )}
                                        </td>
                                        <td className="logo-path">
                                            {doctor.LogoPath || <span className="text-muted">—</span>}
                                        </td>
                                        <td className="actions">
                                            <button
                                                className="btn-icon btn-edit"
                                                onClick={() => handleEdit(doctor)}
                                                title="Edit doctor"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className="btn-icon btn-delete"
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
