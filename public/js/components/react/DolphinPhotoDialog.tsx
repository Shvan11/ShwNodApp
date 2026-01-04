import { useState, useEffect, ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import styles from './DolphinPhotoDialog.module.css';

interface Props {
    personId?: string;
    patientInfo: {
        FirstName?: string;
        PatientName?: string;
    } | null;
    onClose: () => void;
}

interface Appointment {
    date: string;
    description?: string;
}

interface Visit {
    visitDate: string;
}

interface TimepointType {
    value: string;
    label: string;
}

const TIMEPOINT_TYPES: TimepointType[] = [
    { value: 'Initial', label: 'Initial' },
    { value: 'Progress', label: 'Progress' },
    { value: 'Final', label: 'Final' },
    { value: 'Retention', label: 'Retention' }
];

const DolphinPhotoDialog = ({ personId, patientInfo, onClose }: Props) => {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [timepointType, setTimepointType] = useState('Initial');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
    const [skipDolphin, setSkipDolphin] = useState(false);

    useEffect(() => {
        loadPhotoDates();
    }, [personId]);

    const loadPhotoDates = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/dolphin/photo-dates/${personId}`);
            if (!response.ok) throw new Error('Failed to load dates');

            const data = await response.json();
            setAppointments(data.appointments || []);
            setVisits(data.visits || []);
        } catch (error) {
            console.error('Error loading photo dates:', error);
            toast.error('Failed to load appointments and visits');
        } finally {
            setLoading(false);
        }
    };

    const handleDateSelect = (date: Date | string) => {
        if (date instanceof Date) {
            setSelectedDate(date.toISOString().slice(0, 10));
        } else if (typeof date === 'string') {
            // Parse date string if needed
            const parsed = new Date(date);
            if (!isNaN(parsed.getTime())) {
                setSelectedDate(parsed.toISOString().slice(0, 10));
            }
        }
    };

    const handleSubmit = async () => {
        // Validate patient has required fields
        if (!patientInfo?.FirstName && !patientInfo?.PatientName) {
            toast.error('Patient name is required for Dolphin integration');
            return;
        }

        try {
            setSubmitting(true);

            const response = await fetch('/api/dolphin/prepare-photo-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    personId,
                    tpDescription: timepointType,
                    tpDate: selectedDate,
                    skipDolphin
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message || 'Failed to prepare photo import');
            }

            const data = await response.json();

            // Launch the protocol handler
            window.location.href = data.protocolUrl;

            onClose();
        } catch (error) {
            console.error('Error preparing photo import:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to prepare photo import');
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateStr: string): string => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h3>Add Photos to Dolphin</h3>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="fas fa-times" />
                    </button>
                </div>

                <div className={styles.body}>
                    {/* Timepoint Type */}
                    <div className={styles.formGroup}>
                        <label>Timepoint Type</label>
                        <select
                            value={timepointType}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTimepointType(e.target.value)}
                            className={styles.formSelect}
                        >
                            {TIMEPOINT_TYPES.map(tp => (
                                <option key={tp.value} value={tp.value}>{tp.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Selection */}
                    <div className={styles.formGroup}>
                        <label>Photo Date</label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedDate(e.target.value)}
                            className={styles.formInput}
                        />
                    </div>

                    {/* Appointments List */}
                    {loading ? (
                        <div className={styles.loadingPlaceholder}>Loading dates...</div>
                    ) : (
                        <>
                            {appointments.length > 0 && (
                                <div className={styles.dateList}>
                                    <label>Recent Appointments</label>
                                    <div className={styles.dateItems}>
                                        {appointments.slice(0, 5).map((appt, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                className={styles.dateItem}
                                                onClick={() => handleDateSelect(appt.date)}
                                            >
                                                <span className={styles.dateValue}>{formatDate(appt.date)}</span>
                                                {appt.description && (
                                                    <span className={styles.dateDesc}>{appt.description}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {visits.length > 0 && (
                                <div className={styles.dateList}>
                                    <label>Recent Visits</label>
                                    <div className={styles.dateItems}>
                                        {visits.slice(0, 5).map((visit, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                className={styles.dateItem}
                                                onClick={() => handleDateSelect(visit.visitDate)}
                                            >
                                                <span className={styles.dateValue}>{formatDate(visit.visitDate)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Skip Dolphin Checkbox */}
                    <div className={`${styles.formGroup} ${styles.checkboxGroup}`}>
                        <label className={styles.checkboxLabel}>
                            <input
                                type="checkbox"
                                checked={skipDolphin}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setSkipDolphin(e.target.checked)}
                            />
                            <span>Just organize photos (don't launch Dolphin)</span>
                        </label>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={submitting || loading}
                    >
                        {submitting ? 'Preparing...' : 'Select Photos'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DolphinPhotoDialog;
