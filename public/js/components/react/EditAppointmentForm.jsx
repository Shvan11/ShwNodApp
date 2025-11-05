import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import SimplifiedCalendarPicker from './SimplifiedCalendarPicker.jsx'
import '../../../css/components/simplified-calendar-picker.css'

/**
 * EditAppointmentForm Component
 *
 * Allows editing existing appointments with prefilled data
 * Uses the same layout as AppointmentForm
 */

const EditAppointmentForm = ({ patientId, appointmentId, onClose, onSuccess }) => {
    const location = useLocation()
    const existingAppointment = location.state?.appointment

    const [formData, setFormData] = useState({
        PersonID: patientId,
        AppDate: '',
        AppTime: '',
        AppDetail: '',
        DrID: ''
    });
    const [doctors, setDoctors] = useState([]);
    const [details, setDetails] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingData, setLoadingData] = useState(true);
    const [error, setError] = useState(null);
    const [validation, setValidation] = useState({});

    // Load appointment data if not passed via state
    useEffect(() => {
        if (existingAppointment) {
            prefillFormData(existingAppointment)
            setLoadingData(false)
        } else if (appointmentId) {
            loadAppointmentData(appointmentId)
        }
    }, [existingAppointment, appointmentId]);

    useEffect(() => {
        loadDoctors();
        loadDetails();
    }, []);

    const loadAppointmentData = async (id) => {
        try {
            setLoadingData(true)
            const response = await fetch(`/api/appointments/${id}`)
            if (!response.ok) throw new Error('Failed to load appointment')
            const data = await response.json()
            if (data.success && data.appointment) {
                prefillFormData(data.appointment)
            } else {
                throw new Error('Appointment not found')
            }
        } catch (err) {
            console.error('Error loading appointment:', err)
            setError(err.message)
        } finally {
            setLoadingData(false)
        }
    }

    const prefillFormData = (appointment) => {
        const dateTime = new Date(appointment.AppDate)
        const year = dateTime.getFullYear()
        const month = String(dateTime.getMonth() + 1).padStart(2, '0')
        const day = String(dateTime.getDate()).padStart(2, '0')
        const hours = String(dateTime.getHours()).padStart(2, '0')
        const minutes = String(dateTime.getMinutes()).padStart(2, '0')

        setFormData({
            PersonID: appointment.PersonID || patientId,
            AppDate: `${year}-${month}-${day}`,
            AppTime: `${hours}:${minutes}`,
            AppDetail: appointment.AppDetail || '',
            DrID: appointment.DrID || ''
        })
    }

    const loadDoctors = async () => {
        try {
            const response = await fetch('/api/doctors');
            if (!response.ok) throw new Error('Failed to load doctors');
            const data = await response.json();
            setDoctors(data || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
            setError(err.message);
        }
    };

    const loadDetails = async () => {
        try {
            const response = await fetch('/api/appointment-details');
            if (!response.ok) throw new Error('Failed to load appointment details');
            const data = await response.json();
            setDetails(data || []);
        } catch (err) {
            console.error('Error loading appointment details:', err);
            setError(err.message);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (validation[name]) {
            setValidation(prev => ({ ...prev, [name]: null }));
        }
    };

    const handleDateTimeSelection = (dateTime) => {
        const date = new Date(dateTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        setFormData(prev => ({
            ...prev,
            AppDate: `${year}-${month}-${day}`,
            AppTime: `${hours}:${minutes}`
        }));
        setValidation(prev => ({ ...prev, AppDate: null, AppTime: null }));
    };

    const validateForm = () => {
        const errors = {};
        if (!formData.AppDate) errors.AppDate = 'Select a date';
        if (!formData.AppTime) errors.AppTime = 'Select a time';
        if (!formData.DrID) errors.DrID = 'Select a doctor';
        if (!formData.AppDetail) errors.AppDetail = 'Select appointment type';
        setValidation(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;

        setLoading(true);
        setError(null);

        try {
            const appointmentDateTime = `${formData.AppDate}T${formData.AppTime}:00`;
            const response = await fetch(`/api/appointments/${appointmentId || existingAppointment?.appointmentID}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PersonID: parseInt(formData.PersonID),
                    AppDate: appointmentDateTime,
                    AppDetail: formData.AppDetail,
                    DrID: parseInt(formData.DrID)
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update appointment');
            }

            const result = await response.json();
            if (result.success) {
                onSuccess && onSuccess(result);
                onClose && onClose();
            } else {
                throw new Error(result.error || 'Failed to update appointment');
            }
        } catch (err) {
            console.error('Error updating appointment:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getDateTimeDisplay = () => {
        if (formData.AppDate && formData.AppTime) {
            const date = new Date(`${formData.AppDate}T${formData.AppTime}`);
            return date.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        }
        return 'No time selected';
    };

    if (loadingData) {
        return (
            <div className="appointment-form-page">
                <div className="loading-state" style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '400px',
                    flexDirection: 'column',
                    gap: '1rem'
                }}>
                    <i className="fas fa-spinner fa-spin" style={{ fontSize: '3rem', color: '#3b82f6' }}></i>
                    <p>Loading appointment data...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="appointment-form-page">
            {/* Page Header */}
            <header className="page-header">
                <div>
                    <h1><i className="fas fa-calendar-edit"></i> Edit Appointment</h1>
                    <p>Patient #{patientId}</p>
                </div>
                <button className="close-button" onClick={onClose} title="Close">
                    <i className="fas fa-times"></i>
                </button>
            </header>

            {/* Main Content: 3 Columns */}
            <div className="page-content">
                {/* Calendar Picker (LEFT + MIDDLE columns) */}
                <SimplifiedCalendarPicker
                    onSelectDateTime={handleDateTimeSelection}
                    initialDate={formData.AppDate ? new Date(formData.AppDate) : new Date()}
                />

                {/* RIGHT COLUMN: Form */}
                <div className="form-column">
                    <div className="form-header">
                        <h2><i className="fas fa-clipboard-list"></i> Appointment Details</h2>
                    </div>

                    <form onSubmit={handleSubmit} className="appointment-form">
                        {error && (
                            <div className="alert alert-error">
                                <i className="fas fa-exclamation-circle"></i>
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="form-field">
                            <label><i className="fas fa-calendar-check"></i> Selected Time</label>
                            <div className={`selected-time ${formData.AppDate && formData.AppTime ? 'has-value' : ''}`}>
                                {getDateTimeDisplay()}
                            </div>
                            {(validation.AppDate || validation.AppTime) && (
                                <span className="field-error">{validation.AppDate || validation.AppTime}</span>
                            )}
                        </div>

                        <div className="form-field">
                            <label htmlFor="doctor"><i className="fas fa-user-md"></i> Doctor</label>
                            <select
                                id="doctor"
                                name="DrID"
                                value={formData.DrID}
                                onChange={handleInputChange}
                                className={validation.DrID ? 'error' : ''}
                            >
                                <option value="">Select doctor...</option>
                                {doctors.filter(d => d.ID).map((doctor) => (
                                    <option key={doctor.ID} value={doctor.ID}>
                                        {doctor.employeeName}
                                    </option>
                                ))}
                            </select>
                            {validation.DrID && <span className="field-error">{validation.DrID}</span>}
                        </div>

                        <div className="form-field">
                            <label htmlFor="details"><i className="fas fa-notes-medical"></i> Appointment Type</label>
                            <select
                                id="details"
                                name="AppDetail"
                                value={formData.AppDetail}
                                onChange={handleInputChange}
                                className={validation.AppDetail ? 'error' : ''}
                            >
                                <option value="">Select type...</option>
                                {details.filter(d => d.ID).map((detail) => (
                                    <option key={detail.ID} value={detail.Detail}>
                                        {detail.Detail}
                                    </option>
                                ))}
                            </select>
                            {validation.AppDetail && <span className="field-error">{validation.AppDetail}</span>}
                        </div>

                        <div className="form-actions">
                            <button
                                type="button"
                                className="btn btn-cancel"
                                onClick={onClose}
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i>
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-create"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Updating...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-save"></i>
                                        Update Appointment
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default EditAppointmentForm;
