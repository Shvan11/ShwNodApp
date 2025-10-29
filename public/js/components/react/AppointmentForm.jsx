import React, { useState, useEffect } from 'react'
import CalendarPickerModal from './CalendarPickerModal.jsx'

const AppointmentForm = ({ patientId, onClose, onSuccess }) => {
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
    const [error, setError] = useState(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const [validation, setValidation] = useState({});

    // Load doctors and details on component mount
    useEffect(() => {
        loadDoctors();
        loadDetails();
    }, []);

    const loadDoctors = async () => {
        try {
            console.log('Loading doctors...');
            const response = await fetch('/api/doctors');
            console.log('Doctors response status:', response.status);
            if (!response.ok) {
                throw new Error(`Failed to load doctors: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Doctors data received:', data);
            setDoctors(data || []);
        } catch (err) {
            console.error('Error loading doctors:', err);
            setError(`Failed to load doctors: ${err.message}`);
        }
    };

    const loadDetails = async () => {
        try {
            console.log('Loading appointment details...');
            const response = await fetch('/api/appointment-details');
            console.log('Details response status:', response.status);
            if (!response.ok) {
                throw new Error(`Failed to load appointment details: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Details data received:', data);
            setDetails(data || []);
        } catch (err) {
            console.error('Error loading appointment details:', err);
            setError(`Failed to load appointment details: ${err.message}`);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        // Clear validation error when user starts typing
        if (validation[name]) {
            setValidation(prev => ({
                ...prev,
                [name]: null
            }));
        }
    };

    const handleDateTimeSelection = (dateTime) => {
        const date = new Date(dateTime);
        setFormData(prev => ({
            ...prev,
            AppDate: date.toISOString().split('T')[0],
            AppTime: date.toTimeString().split(' ')[0].slice(0, 5)
        }));
        setShowCalendar(false);
    };

    const validateForm = () => {
        const newValidation = {};
        
        if (!formData.AppDate) {
            newValidation.AppDate = 'Please select a date';
        }
        
        if (!formData.AppTime) {
            newValidation.AppTime = 'Please select a time';
        }
        
        if (!formData.DrID) {
            newValidation.DrID = 'Please select a doctor';
        }
        
        if (!formData.AppDetail) {
            newValidation.AppDetail = 'Please select appointment details';
        }

        setValidation(newValidation);
        return Object.keys(newValidation).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Combine date and time for the API
            const appointmentDateTime = `${formData.AppDate}T${formData.AppTime}:00`;
            
            const response = await fetch('/api/appointments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    PersonID: parseInt(formData.PersonID),
                    AppDate: appointmentDateTime,
                    AppDetail: formData.AppDetail,
                    DrID: parseInt(formData.DrID)
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create appointment');
            }

            const result = await response.json();
            
            if (result.success) {
                onSuccess && onSuccess(result);
                onClose && onClose();
            } else {
                throw new Error(result.error || 'Failed to create appointment');
            }

        } catch (err) {
            console.error('Error creating appointment:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getDateTime = () => {
        if (formData.AppDate && formData.AppTime) {
            const date = new Date(`${formData.AppDate}T${formData.AppTime}`);
            return date.toLocaleString();
        }
        return 'Select date and time';
    };

    return (
        <div className="appointment-form-overlay">
            <div className="appointment-form-modal">
                <div className="appointment-form-header">
                    <h2>New Appointment</h2>
                    <button
                        type="button"
                        className="close-btn"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClose();
                        }}
                        aria-label="Close form"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="appointment-form">
                    {error && (
                        <div className="error-message">
                            <i className="fas fa-exclamation-triangle"></i>
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label htmlFor="patient-id">Patient ID</label>
                        <input
                            type="text"
                            id="patient-id"
                            value={`Patient ${patientId}`}
                            disabled
                            className="form-input disabled"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="datetime">Date & Time</label>
                        <div className="datetime-selector">
                            <input
                                type="text"
                                id="datetime"
                                value={getDateTime()}
                                readOnly
                                className={`form-input ${validation.AppDate || validation.AppTime ? 'error' : ''}`}
                                onClick={() => setShowCalendar(true)}
                            />
                            <button
                                type="button"
                                className="calendar-btn"
                                onClick={() => setShowCalendar(true)}
                            >
                                <i className="fas fa-calendar-alt"></i>
                            </button>
                        </div>
                        {(validation.AppDate || validation.AppTime) && (
                            <span className="validation-error">
                                {validation.AppDate || validation.AppTime}
                            </span>
                        )}
                    </div>

                    <div className="form-group">
                        <label htmlFor="doctor">Doctor</label>
                        <select
                            id="doctor"
                            name="DrID"
                            value={formData.DrID}
                            onChange={handleInputChange}
                            className={`form-input ${validation.DrID ? 'error' : ''}`}
                        >
                            <option key="doctor-default" value="">Select a doctor</option>
                            {doctors
                                .filter(doctor => doctor.ID != null) // Filter out null/undefined IDs
                                .map((doctor, index) => (
                                <option key={`doctor-${doctor.ID || index}`} value={doctor.ID}>
                                    {doctor.employeeName}
                                </option>
                            ))}
                        </select>
                        {validation.DrID && (
                            <span className="validation-error">{validation.DrID}</span>
                        )}
                    </div>

                    <div className="form-group">
                        <label htmlFor="details">Appointment Details</label>
                        <select
                            id="details"
                            name="AppDetail"
                            value={formData.AppDetail}
                            onChange={handleInputChange}
                            className={`form-input ${validation.AppDetail ? 'error' : ''}`}
                        >
                            <option key="detail-default" value="">Select appointment details</option>
                            {details
                                .filter(detail => detail.ID != null) // Filter out null/undefined IDs
                                .map((detail, index) => (
                                <option key={`detail-${detail.ID || index}`} value={detail.Detail}>
                                    {detail.Detail}
                                </option>
                            ))}
                        </select>
                        {validation.AppDetail && (
                            <span className="validation-error">{validation.AppDetail}</span>
                        )}
                    </div>

                    <div className="form-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onClose();
                            }}
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i>
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-plus"></i>
                                    Create Appointment
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {showCalendar && (
                    <CalendarPickerModal
                        onSelectDateTime={handleDateTimeSelection}
                        onClose={() => setShowCalendar(false)}
                        initialDate={formData.AppDate ? new Date(formData.AppDate) : new Date()}
                    />
                )}
            </div>
        </div>
    );
};


export default AppointmentForm;