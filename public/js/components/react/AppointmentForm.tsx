import { useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import SimplifiedCalendarPicker from './SimplifiedCalendarPicker';
import '../../../css/components/simplified-calendar-picker.css';

interface AppointmentFormData {
    PersonID: number | string;
    AppDate: string;
    AppTime: string;
    AppDetail: string;
    DrID: string;
}

interface ValidationErrors {
    [key: string]: string | null;
}

interface Doctor {
    ID: number;
    employeeName: string;
}

interface AppointmentDetail {
    ID: number;
    Detail: string;
}

interface AppointmentFormProps {
    patientId?: number | string;
    onClose?: () => void;
    onSuccess?: (result: unknown) => void;
}

interface ApiErrorResponse {
    error?: string;
    code?: string;
    details?: {
        holidayName?: string;
    };
}

/**
 * AppointmentForm Component - CLEAN REWRITE
 *
 * Full-page layout with 3 columns:
 * LEFT: Monthly calendar (from SimplifiedCalendarPicker)
 * MIDDLE: Day schedule (from SimplifiedCalendarPicker)
 * RIGHT: Appointment details form
 */

const AppointmentForm = ({ patientId, onClose, onSuccess }: AppointmentFormProps) => {
    const [formData, setFormData] = useState<AppointmentFormData>({
        PersonID: patientId ?? '',
        AppDate: '',
        AppTime: '',
        AppDetail: '',
        DrID: ''
    });
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [details, setDetails] = useState<AppointmentDetail[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [validation, setValidation] = useState<ValidationErrors>({});

    useEffect(() => {
        loadDoctors();
        loadDetails();
    }, []);

    const loadDoctors = async (): Promise<void> => {
        try {
            // Fetch all employees who can receive appointments (doctors, hygienists, etc.)
            const response = await fetch('/api/employees?getAppointments=true');
            if (!response.ok) throw new Error('Failed to load employees');
            const data = await response.json();
            setDoctors(data?.employees || []);
        } catch (err) {
            console.error('Error loading employees:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    };

    const loadDetails = async (): Promise<void> => {
        try {
            const response = await fetch('/api/appointment-details');
            if (!response.ok) throw new Error('Failed to load appointment details');
            const data = await response.json();
            setDetails(data || []);
        } catch (err) {
            console.error('Error loading appointment details:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>): void => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (validation[name]) {
            setValidation(prev => ({ ...prev, [name]: null }));
        }
    };

    const handleDateTimeSelection = (dateTime: Date | string): void => {
        const date = new Date(dateTime);
        // Extract date components without timezone conversion to avoid -1 day offset
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

    const validateForm = (): boolean => {
        const errors: ValidationErrors = {};
        if (!formData.AppDate) errors.AppDate = 'Select a date';
        if (!formData.AppTime) errors.AppTime = 'Select a time';
        if (!formData.DrID) errors.DrID = 'Select a doctor';
        if (!formData.AppDetail) errors.AppDetail = 'Select appointment type';
        setValidation(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        if (!validateForm()) return;

        setLoading(true);
        setError(null);

        try {
            const appointmentDateTime = `${formData.AppDate}T${formData.AppTime}:00`;
            const response = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PersonID: parseInt(String(formData.PersonID)),
                    AppDate: appointmentDateTime,
                    AppDetail: formData.AppDetail,
                    DrID: parseInt(formData.DrID)
                })
            });

            if (!response.ok) {
                const errorData: ApiErrorResponse = await response.json();

                // Handle holiday conflict specifically
                if (errorData.code === 'HOLIDAY_CONFLICT') {
                    const holidayName = errorData.details?.holidayName || 'Holiday';
                    setError(`Cannot create appointment: ${holidayName} is a holiday. No appointments are allowed on this date.`);
                    return;
                }

                // Handle other conflict types
                if (errorData.code === 'APPOINTMENT_CONFLICT') {
                    setError('Patient already has an appointment on this date.');
                    return;
                }

                throw new Error(errorData.error || 'Failed to create appointment');
            }

            const result = await response.json();
            if (result.success) {
                // Only call onSuccess, it will handle navigation
                // Don't call onClose as it might interfere with navigation
                if (onSuccess) {
                    onSuccess(result);
                } else if (onClose) {
                    onClose();
                }
            } else {
                throw new Error(result.error || 'Failed to create appointment');
            }
        } catch (err) {
            console.error('Error creating appointment:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const getDateTimeDisplay = (): string => {
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

    return (
        <div className="appointment-form-page">
            {/* Page Header */}
            <header className="page-header">
                <div>
                    <h1><i className="fas fa-calendar-plus"></i> New Appointment</h1>
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
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-check"></i>
                                        Create Appointment
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

export default AppointmentForm;
