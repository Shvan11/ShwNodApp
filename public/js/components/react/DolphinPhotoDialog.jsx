import { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import '../../../css/components/dolphin-photo-dialog.css';

const TIMEPOINT_TYPES = [
    { value: 'Initial', label: 'Initial' },
    { value: 'Progress', label: 'Progress' },
    { value: 'Final', label: 'Final' },
    { value: 'Retention', label: 'Retention' }
];

const DolphinPhotoDialog = ({ patientId, patientInfo, onClose }) => {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [appointments, setAppointments] = useState([]);
    const [visits, setVisits] = useState([]);
    const [timepointType, setTimepointType] = useState('Initial');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
    const [skipDolphin, setSkipDolphin] = useState(false);

    useEffect(() => {
        loadPhotoDates();
    }, [patientId]);

    const loadPhotoDates = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/dolphin/photo-dates/${patientId}`);
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

    const handleDateSelect = (date) => {
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
                    personId: patientId,
                    tpDescription: timepointType,
                    tpDate: selectedDate,
                    skipDolphin
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to prepare photo import');
            }

            const data = await response.json();

            // Launch the protocol handler
            window.location.href = data.protocolUrl;

            onClose();
        } catch (error) {
            console.error('Error preparing photo import:', error);
            toast.error(error.message || 'Failed to prepare photo import');
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    return (
        <div className="dolphin-photo-dialog-overlay" onClick={onClose}>
            <div className="dolphin-photo-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <h3>Add Photos to Dolphin</h3>
                    <button className="close-btn" onClick={onClose}>
                        <i className="fas fa-times" />
                    </button>
                </div>

                <div className="dialog-body">
                    {/* Timepoint Type */}
                    <div className="form-group">
                        <label>Timepoint Type</label>
                        <select
                            value={timepointType}
                            onChange={(e) => setTimepointType(e.target.value)}
                            className="form-select"
                        >
                            {TIMEPOINT_TYPES.map(tp => (
                                <option key={tp.value} value={tp.value}>{tp.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Selection */}
                    <div className="form-group">
                        <label>Photo Date</label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="form-input"
                        />
                    </div>

                    {/* Appointments List */}
                    {loading ? (
                        <div className="loading-placeholder">Loading dates...</div>
                    ) : (
                        <>
                            {appointments.length > 0 && (
                                <div className="date-list">
                                    <label>Recent Appointments</label>
                                    <div className="date-items">
                                        {appointments.slice(0, 5).map((appt, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                className="date-item"
                                                onClick={() => handleDateSelect(appt.date)}
                                            >
                                                <span className="date-value">{formatDate(appt.date)}</span>
                                                {appt.description && (
                                                    <span className="date-desc">{appt.description}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {visits.length > 0 && (
                                <div className="date-list">
                                    <label>Recent Visits</label>
                                    <div className="date-items">
                                        {visits.slice(0, 5).map((visit, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                className="date-item"
                                                onClick={() => handleDateSelect(visit.visitDate)}
                                            >
                                                <span className="date-value">{formatDate(visit.visitDate)}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Skip Dolphin Checkbox */}
                    <div className="form-group checkbox-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={skipDolphin}
                                onChange={(e) => setSkipDolphin(e.target.checked)}
                            />
                            <span>Just organize photos (don't launch Dolphin)</span>
                        </label>
                    </div>
                </div>

                <div className="dialog-footer">
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
