import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
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

    // Reset the form when the modal opens or the holiday changes. Done during render
    // (keyed on open + holiday identity) rather than in an effect, so the React
    // Compiler can optimize and there's no extra post-paint render.
    const initKey = isOpen ? String(existingHoliday?.ID ?? 'new') : '';
    const [initializedKey, setInitializedKey] = useState('');
    if (initKey !== initializedKey) {
        setInitializedKey(initKey);
        if (isOpen) {
            setHolidayName(existingHoliday?.HolidayName || '');
            setDescription(existingHoliday?.Description || '');
            setShowWarning(false);
        }
    }

    // Show the appointment warning if one is provided (adjust-during-render rather
    // than an effect; tracks the previous warning so it only fires on a change —
    // initialized to null so a warning already present at mount still surfaces,
    // matching the original effect's mount run).
    const [prevWarning, setPrevWarning] = useState<AppointmentWarning | null>(null);
    if (appointmentWarning !== prevWarning) {
        setPrevWarning(appointmentWarning);
        if (appointmentWarning && appointmentWarning.count > 0) {
            setShowWarning(true);
        }
    }

    // Focus the input after the modal opens; clear on unmount/close so the timer
    // can't fire (and focus) after the modal is gone.
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!date) return null;

    const formatDate = (dateStr: string): string => {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, {
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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            contentClassName="modal-content modal-sm"
            overlayClassName="holiday-quick-modal"
            ariaLabelledBy="holiday-quick-modal-title"
        >
                <ModalHeader
                    title={existingHoliday ? 'Edit Holiday' : 'Add Holiday'}
                    titleId="holiday-quick-modal-title"
                    icon={<i className="fas fa-calendar-times" />}
                    onClose={onClose}
                />

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
                                            {apt.patient_name}
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
        </Modal>
    );
};

export default HolidayQuickModal;
