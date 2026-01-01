import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import type { ExistingHoliday, AppointmentWarning, SaveHolidayData } from './calendar.types';

interface HolidayQuickModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: SaveHolidayData) => Promise<void>;
    date?: string;
    existingHoliday?: ExistingHoliday | null;
    appointmentWarning?: AppointmentWarning | null;
}

/**
 * HolidayQuickModal Component
 * Quick add/edit holiday modal triggered from calendar right-click
 */
const HolidayQuickModal = ({
    isOpen,
    onClose,
    onSave,
    date,
    existingHoliday = null,
    appointmentWarning = null
}: HolidayQuickModalProps) => {
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [holidayName, setHolidayName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [showWarning, setShowWarning] = useState(false);

    // Reset form when modal opens/closes or holiday changes
    useEffect(() => {
        if (isOpen) {
            setHolidayName(existingHoliday?.HolidayName || '');
            setDescription(existingHoliday?.Description || '');
            setShowWarning(false);
            // Focus input after modal opens
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen, existingHoliday]);

    // Show appointment warning if provided
    useEffect(() => {
        if (appointmentWarning && appointmentWarning.count > 0) {
            setShowWarning(true);
        }
    }, [appointmentWarning]);

    if (!isOpen || !date) return null;

    const formatDate = (dateStr: string): string => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!holidayName.trim()) {
            toast.warning('Please enter a holiday name');
            return;
        }

        setSaving(true);
        try {
            await onSave({
                date,
                holidayName: holidayName.trim(),
                description: description.trim(),
                existingId: existingHoliday?.ID
            });
        } finally {
            setSaving(false);
        }
    };

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="modal-overlay holiday-quick-modal" onClick={handleOverlayClick}>
            <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>
                        <i className="fas fa-calendar-times"></i>
                        {existingHoliday ? 'Edit Holiday' : 'Add Holiday'}
                    </h3>
                    <button className="modal-close" onClick={onClose} type="button">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {/* Date display */}
                        <div className="holiday-date-display">
                            <i className="fas fa-calendar-day"></i>
                            <span>{formatDate(date)}</span>
                        </div>

                        {/* Appointment warning */}
                        {showWarning && appointmentWarning && (
                            <div className="holiday-warning-banner">
                                <div className="warning-icon">
                                    <i className="fas fa-exclamation-triangle"></i>
                                </div>
                                <div className="warning-content">
                                    <strong>{appointmentWarning.count} appointment(s)</strong> scheduled on this date
                                    <div className="warning-note">
                                        These will NOT be automatically cancelled
                                    </div>
                                    {appointmentWarning.appointments?.slice(0, 3).map((apt, idx) => (
                                        <div key={idx} className="warning-appointment">
                                            <i className="fas fa-user"></i>
                                            {apt.PatientName}
                                        </div>
                                    ))}
                                    {appointmentWarning.count > 3 && (
                                        <div className="warning-more">
                                            +{appointmentWarning.count - 3} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Holiday name */}
                        <div className="form-group">
                            <label htmlFor="holidayName">Holiday Name *</label>
                            <input
                                ref={inputRef}
                                type="text"
                                id="holidayName"
                                className="form-control"
                                value={holidayName}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setHolidayName(e.target.value)}
                                placeholder="e.g., Newroz, Eid al-Fitr"
                                required
                            />
                        </div>

                        {/* Description (optional) */}
                        <div className="form-group">
                            <label htmlFor="holidayDescription">Description (optional)</label>
                            <input
                                type="text"
                                id="holidayDescription"
                                className="form-control"
                                value={description}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
                                placeholder="Optional notes"
                            />
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                            disabled={saving}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className={`btn ${showWarning ? 'btn-warning' : 'btn-primary'}`}
                            disabled={saving}
                        >
                            {saving ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-check"></i>
                                    {existingHoliday ? 'Update' : 'Add'} Holiday
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default HolidayQuickModal;
