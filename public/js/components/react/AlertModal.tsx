import { useState, useEffect } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';

interface AlertType {
    AlertTypeID: number;
    TypeName: string;
}

interface AlertFormData {
    alertTypeId: string;
    alertSeverity: string;
    alertDetails: string;
}

interface FormErrors {
    alertTypeId?: string;
    alertSeverity?: string;
    alertDetails?: string;
}

interface EditAlertData {
    AlertID: number;
    AlertTypeID?: number;
    AlertSeverity?: number;
    AlertDetails: string;
}

interface AlertModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave?: () => Promise<void>;
    personId: number | string;
    alertTypes: AlertType[];
    editAlert?: EditAlertData | null;
}

/**
 * Alert Modal Component
 * Modal for creating or editing patient alerts
 */
const AlertModal = ({ isOpen, onClose, onSave, personId, alertTypes, editAlert }: AlertModalProps) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState<AlertFormData>({
        alertTypeId: '',
        alertSeverity: '2', // Default to Moderate
        alertDetails: ''
    });

    const [errors, setErrors] = useState<FormErrors>({});

    const isEditMode = !!editAlert;

    // Populate form when editing
    useEffect(() => {
        if (editAlert && isOpen) {
            setFormData({
                alertTypeId: editAlert.AlertTypeID?.toString() || '',
                alertSeverity: editAlert.AlertSeverity?.toString() || '2',
                alertDetails: editAlert.AlertDetails || ''
            });
        } else if (!isOpen) {
            // Reset form when modal closes
            setFormData({
                alertTypeId: '',
                alertSeverity: '2',
                alertDetails: ''
            });
            setErrors({});
        }
    }, [editAlert, isOpen]);

    // Handle form field changes
    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        // Clear error for this field
        if (errors[name as keyof FormErrors]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    // Validate form
    const validateForm = (): boolean => {
        const newErrors: FormErrors = {};

        if (!formData.alertTypeId) {
            newErrors.alertTypeId = 'Please select an alert type';
        }

        if (!formData.alertSeverity) {
            newErrors.alertSeverity = 'Please select a severity level';
        }

        if (!formData.alertDetails.trim()) {
            newErrors.alertDetails = 'Please enter alert details';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Handle save
    const handleSave = async () => {
        if (!validateForm()) {
            toast.error('Please fill in all required fields');
            return;
        }

        setLoading(true);

        try {
            const url = isEditMode
                ? `/api/alerts/${editAlert!.AlertID}`
                : `/api/patients/${personId}/alerts`;

            const response = await fetch(url, {
                method: isEditMode ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    alertTypeId: parseInt(formData.alertTypeId),
                    alertSeverity: parseInt(formData.alertSeverity),
                    alertDetails: formData.alertDetails.trim()
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to ${isEditMode ? 'update' : 'create'} alert`);
            }

            toast.success(`Alert ${isEditMode ? 'updated' : 'created'} successfully`);

            // Reset form
            setFormData({
                alertTypeId: '',
                alertSeverity: '2',
                alertDetails: ''
            });
            setErrors({});

            // Call parent callback
            if (onSave) {
                await onSave();
            }

            // Close modal
            onClose();
        } catch (error) {
            console.error(`Error ${isEditMode ? 'updating' : 'creating'} alert:`, error);
            toast.error(error instanceof Error ? error.message : `Failed to ${isEditMode ? 'update' : 'create'} alert`);
        } finally {
            setLoading(false);
        }
    };

    // Handle cancel
    const handleCancel = () => {
        setFormData({
            alertTypeId: '',
            alertSeverity: '2',
            alertDetails: ''
        });
        setErrors({});
        onClose();
    };

    // Handle overlay click
    const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            handleCancel();
        }
    };

    // Don't render if not open
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div className="modal-content alert-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>
                        <i className="fas fa-exclamation-triangle"></i>
                        {isEditMode ? 'Edit Alert' : 'Add New Alert'}
                    </h3>
                    <button
                        type="button"
                        className="modal-close-btn"
                        onClick={handleCancel}
                        aria-label="Close modal"
                    >
                        &times;
                    </button>
                </div>

                <div className="modal-body">
                    <form className="alert-form">
                        {/* Alert Type */}
                        <div className="form-group">
                            <label htmlFor="alertTypeId">
                                Alert Type <span className="required">*</span>
                            </label>
                            <select
                                id="alertTypeId"
                                name="alertTypeId"
                                value={formData.alertTypeId}
                                onChange={handleChange}
                                className={errors.alertTypeId ? 'error' : ''}
                                disabled={loading}
                            >
                                <option value="">Select alert type...</option>
                                {alertTypes.map(type => (
                                    <option key={type.AlertTypeID} value={type.AlertTypeID}>
                                        {type.TypeName}
                                    </option>
                                ))}
                            </select>
                            {errors.alertTypeId && (
                                <span className="error-message">{errors.alertTypeId}</span>
                            )}
                        </div>

                        {/* Severity */}
                        <div className="form-group">
                            <label>
                                Severity Level <span className="required">*</span>
                            </label>
                            <div className="severity-options">
                                <label className="severity-option">
                                    <input
                                        type="radio"
                                        name="alertSeverity"
                                        value="1"
                                        checked={formData.alertSeverity === '1'}
                                        onChange={handleChange}
                                        disabled={loading}
                                    />
                                    <span className="severity-badge severity-1">Mild</span>
                                </label>
                                <label className="severity-option">
                                    <input
                                        type="radio"
                                        name="alertSeverity"
                                        value="2"
                                        checked={formData.alertSeverity === '2'}
                                        onChange={handleChange}
                                        disabled={loading}
                                    />
                                    <span className="severity-badge severity-2">Moderate</span>
                                </label>
                                <label className="severity-option">
                                    <input
                                        type="radio"
                                        name="alertSeverity"
                                        value="3"
                                        checked={formData.alertSeverity === '3'}
                                        onChange={handleChange}
                                        disabled={loading}
                                    />
                                    <span className="severity-badge severity-3">Severe</span>
                                </label>
                            </div>
                            {errors.alertSeverity && (
                                <span className="error-message">{errors.alertSeverity}</span>
                            )}
                        </div>

                        {/* Alert Details */}
                        <div className="form-group">
                            <label htmlFor="alertDetails">
                                Alert Details <span className="required">*</span>
                            </label>
                            <textarea
                                id="alertDetails"
                                name="alertDetails"
                                value={formData.alertDetails}
                                onChange={handleChange}
                                placeholder="Enter details about this alert..."
                                rows={4}
                                className={errors.alertDetails ? 'error' : ''}
                                disabled={loading}
                            ></textarea>
                            {errors.alertDetails && (
                                <span className="error-message">{errors.alertDetails}</span>
                            )}
                        </div>
                    </form>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleCancel}
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                Save Alert
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertModal;
