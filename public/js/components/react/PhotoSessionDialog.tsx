import { useState, useEffect, ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import Modal from './Modal';
import styles from './PhotoSessionDialog.module.css';

interface Props {
    personId?: string;
    patientInfo: {
        FirstName?: string;
        PatientName?: string;
    } | null;
    onClose: () => void;
    /** Called once a timepoint is prepared, to hand off to the in-app editor. */
    onPrepared?: (result: { tpCode: number; tpName: string; tpDate: string }) => void;
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

interface ConflictInfo {
    conflictType: string;
    existingDate: string;
    requestedDate: string;
    message: string;
}

const PhotoSessionDialog = ({ personId, patientInfo, onClose, onPrepared }: Props) => {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [timepointType, setTimepointType] = useState('Initial');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
    const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);

    useEffect(() => {
        loadPhotoDates();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId]);

    const loadPhotoDates = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/photo-editor/${personId}/photo-dates`);
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
        // Always parse and use local date components to match the display format
        const dateObj = date instanceof Date ? date : new Date(date);

        if (isNaN(dateObj.getTime())) {
            return; // Invalid date
        }

        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        setSelectedDate(`${year}-${month}-${day}`);
    };

    const handleSubmit = async (overrideDate = false) => {
        if (!patientInfo?.FirstName && !patientInfo?.PatientName) {
            toast.error('Patient name is required');
            return;
        }

        try {
            setSubmitting(true);
            setConflictInfo(null);

            const response = await fetch(`/api/photo-editor/${personId}/prepare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tpDescription: timepointType, tpDate: selectedDate, overrideDate })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message || 'Failed to prepare photo session');
            }

            const data = await response.json();

            // tblwork date conflict — offer to override the existing Initial/Final date.
            if (data.conflict) {
                setConflictInfo({
                    conflictType: data.conflictType,
                    existingDate: data.existingDate,
                    requestedDate: data.requestedDate,
                    message: data.message
                });
                setSubmitting(false);
                return;
            }

            // Hand off to the in-app editor.
            onPrepared?.({ tpCode: data.tpCode, tpName: timepointType, tpDate: selectedDate });
            onClose();
        } catch (error) {
            console.error('Error preparing photo session:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to prepare photo session');
        } finally {
            setSubmitting(false);
        }
    };

    const handleOverrideConfirm = () => {
        handleSubmit(true);
    };

    const handleOverrideCancel = () => {
        setConflictInfo(null);
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
        <Modal isOpen={true} onClose={onClose} contentClassName={styles.dialog}>
                <div className={styles.header}>
                    <h3>New Photo Session</h3>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="fas fa-times" />
                    </button>
                </div>

                <div className={styles.body}>
                    {/* Conflict Warning */}
                    {conflictInfo && (
                        <div className={styles.conflictWarning}>
                            <div className={styles.conflictIcon}>
                                <i className="fas fa-exclamation-triangle" />
                            </div>
                            <div className={styles.conflictContent}>
                                <strong>Date Conflict Detected</strong>
                                <p>{conflictInfo.message}</p>
                                <p>Do you want to override the existing date?</p>
                                <div className={styles.conflictActions}>
                                    <button
                                        type="button"
                                        className="btn btn-warning"
                                        onClick={handleOverrideConfirm}
                                        disabled={submitting}
                                    >
                                        {submitting ? 'Updating...' : 'Yes, Override'}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={handleOverrideCancel}
                                        disabled={submitting}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Timepoint Type */}
                    <div className={styles.formGroup}>
                        <label>Timepoint Type</label>
                        <select
                            value={timepointType}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTimepointType(e.target.value)}
                            className={styles.formSelect}
                            disabled={!!conflictInfo}
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
                            disabled={!!conflictInfo}
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
                </div>

                <div className={styles.footer}>
                    {!conflictInfo && (
                        <>
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
                                onClick={() => handleSubmit(false)}
                                disabled={submitting || loading}
                            >
                                {submitting ? 'Opening…' : 'Open Editor'}
                            </button>
                        </>
                    )}
                </div>
        </Modal>
    );
};

export default PhotoSessionDialog;
