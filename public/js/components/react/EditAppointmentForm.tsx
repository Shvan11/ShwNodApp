import { useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import cn from 'classnames';
import SimplifiedCalendarPicker from './SimplifiedCalendarPicker';
import styles from './AppointmentForm.module.css';

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

interface ExistingAppointment {
    appointmentID?: number;
    PersonID?: number;
    AppDate: string;
    AppDetail?: string;
    DrID?: number | string;
}

interface EditAppointmentFormProps {
    personId?: number | null;
    appointmentId?: number | string;
    onClose?: () => void;
    onSuccess?: (result: unknown) => void;
}

/**
 * EditAppointmentForm Component
 *
 * Allows editing existing appointments with prefilled data
 * Uses the same layout as AppointmentForm
 */

const EditAppointmentForm = ({ personId, appointmentId, onClose, onSuccess }: EditAppointmentFormProps) => {
    const location = useLocation();
    const existingAppointment = (location.state as { appointment?: ExistingAppointment } | null)?.appointment;

    const [formData, setFormData] = useState<AppointmentFormData>({
        PersonID: personId ?? '',
        AppDate: '',
        AppTime: '',
        AppDetail: '',
        DrID: ''
    });
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [details, setDetails] = useState<AppointmentDetail[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [loadingData, setLoadingData] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [validation, setValidation] = useState<ValidationErrors>({});

    // Load appointment data if not passed via state
    useEffect(() => {
        if (existingAppointment) {
            prefillFormData(existingAppointment);
            setLoadingData(false);
        } else if (appointmentId) {
            loadAppointmentData(appointmentId);
        }
    }, [existingAppointment, appointmentId]);

    useEffect(() => {
        loadDoctors();
        loadDetails();
    }, []);

    const loadAppointmentData = async (id: number | string): Promise<void> => {
        try {
            setLoadingData(true);
            const response = await fetch(`/api/appointments/${id}`);
            if (!response.ok) throw new Error('Failed to load appointment');
            const data = await response.json();
            if (data.success && data.appointment) {
                prefillFormData(data.appointment);
            } else {
                throw new Error('Appointment not found');
            }
        } catch (err) {
            console.error('Error loading appointment:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoadingData(false);
        }
    };

    const prefillFormData = (appointment: ExistingAppointment): void => {
        const dateTime = new Date(appointment.AppDate);
        const year = dateTime.getFullYear();
        const month = String(dateTime.getMonth() + 1).padStart(2, '0');
        const day = String(dateTime.getDate()).padStart(2, '0');
        const hours = String(dateTime.getHours()).padStart(2, '0');
        const minutes = String(dateTime.getMinutes()).padStart(2, '0');

        setFormData({
            PersonID: appointment.PersonID ?? '',
            AppDate: `${year}-${month}-${day}`,
            AppTime: `${hours}:${minutes}`,
            AppDetail: appointment.AppDetail || '',
            DrID: String(appointment.DrID || '')
        });
    };

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
            const response = await fetch(`/api/appointments/${appointmentId || existingAppointment?.appointmentID}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PersonID: parseInt(String(formData.PersonID)),
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

    if (loadingData) {
        return (
            <div className={styles.page}>
                <div className={styles.loadingState}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <p>Loading appointment data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            {/* Page Header */}
            <header className={styles.pageHeader}>
                <div>
                    <h1><i className="fas fa-calendar-edit"></i> Edit Appointment</h1>
                    <p>Patient #{personId}</p>
                </div>
                <button className={styles.closeButton} onClick={onClose} title="Close">
                    <i className="fas fa-times"></i>
                </button>
            </header>

            {/* Main Content: 3 Columns */}
            <div className={styles.pageContent}>
                {/* Calendar Picker (LEFT + MIDDLE columns) */}
                <SimplifiedCalendarPicker
                    onSelectDateTime={handleDateTimeSelection}
                    initialDate={formData.AppDate ? new Date(formData.AppDate) : new Date()}
                />

                {/* RIGHT COLUMN: Form */}
                <div className={styles.formColumn}>
                    <div className={styles.formHeader}>
                        <h2><i className="fas fa-clipboard-list"></i> Appointment Details</h2>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        {error && (
                            <div className={cn(styles.alert, styles.alertError)}>
                                <i className="fas fa-exclamation-circle"></i>
                                <span>{error}</span>
                            </div>
                        )}

                        <div className={styles.formField}>
                            <label><i className="fas fa-calendar-check"></i> Selected Time</label>
                            <div className={cn(styles.selectedTime, { [styles.hasValue]: formData.AppDate && formData.AppTime })}>
                                {getDateTimeDisplay()}
                            </div>
                            {(validation.AppDate || validation.AppTime) && (
                                <span className={styles.fieldError}>{validation.AppDate || validation.AppTime}</span>
                            )}
                        </div>

                        <div className={styles.formField}>
                            <label htmlFor="doctor"><i className="fas fa-user-md"></i> Doctor</label>
                            <select
                                id="doctor"
                                name="DrID"
                                value={formData.DrID}
                                onChange={handleInputChange}
                                className={validation.DrID ? styles.error : ''}
                            >
                                <option value="">Select doctor...</option>
                                {doctors.filter(d => d.ID).map((doctor) => (
                                    <option key={doctor.ID} value={doctor.ID}>
                                        {doctor.employeeName}
                                    </option>
                                ))}
                            </select>
                            {validation.DrID && <span className={styles.fieldError}>{validation.DrID}</span>}
                        </div>

                        <div className={styles.formField}>
                            <label htmlFor="details"><i className="fas fa-notes-medical"></i> Appointment Type</label>
                            <select
                                id="details"
                                name="AppDetail"
                                value={formData.AppDetail}
                                onChange={handleInputChange}
                                className={validation.AppDetail ? styles.error : ''}
                            >
                                <option value="">Select type...</option>
                                {details.filter(d => d.ID).map((detail) => (
                                    <option key={detail.ID} value={detail.Detail}>
                                        {detail.Detail}
                                    </option>
                                ))}
                            </select>
                            {validation.AppDetail && <span className={styles.fieldError}>{validation.AppDetail}</span>}
                        </div>

                        <div className={styles.formActions}>
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
