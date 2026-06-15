import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { postJSON, putJSON, httpErrorMessage } from '@/core/http';
import { notifyTasksChanged } from '@/services/tasks';
import Modal from './Modal';
import ModalHeader from './ModalHeader';

interface AlertType {
    alert_type_id: number;
    type_name: string;
}

interface AlertFormData {
    alertTypeId: string;
    alertSeverity: string;
    alertDetails: string;
    expiresAt: string;
    escalateAt: string;
    showInHeader: boolean;
}

interface FormErrors {
    alertTypeId?: string;
    alertSeverity?: string;
    alertDetails?: string;
}

interface EditAlertData {
    alert_id: number;
    alert_type_id?: number;
    alert_severity?: number;
    alert_details: string;
    surface_mode?: string;
    expires_at?: string | null;
    escalate_at?: string | null;
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
        alertDetails: '',
        expiresAt: '',
        escalateAt: '',
        showInHeader: false,
    });

    const [errors, setErrors] = useState<FormErrors>({});

    const isEditMode = !!editAlert;

    // Populate (edit) or reset (close) the form. Done during render (keyed on open +
    // edit-target identity) rather than in an effect, so the React Compiler can
    // optimize and there's no extra post-paint render.
    const initKey = isOpen ? String(editAlert?.alert_id ?? 'new') : '';
    const [initializedKey, setInitializedKey] = useState('');
    if (initKey !== initializedKey) {
        setInitializedKey(initKey);
        if (editAlert && isOpen) {
            setFormData({
                alertTypeId: editAlert.alert_type_id?.toString() || '',
                alertSeverity: editAlert.alert_severity?.toString() || '2',
                alertDetails: editAlert.alert_details || '',
                expiresAt: editAlert.expires_at || '',
                escalateAt: editAlert.escalate_at || '',
                showInHeader: editAlert.surface_mode === 'push',
            });
            setErrors({});
        } else if (!isOpen) {
            // Reset form when modal closes
            setFormData({
                alertTypeId: '',
                alertSeverity: '2',
                alertDetails: '',
                expiresAt: '',
                escalateAt: '',
                showInHeader: false,
            });
            setErrors({});
        }
    }

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
                ? `/api/alerts/${editAlert!.alert_id}`
                : `/api/patients/${personId}/alerts`;

            const body = {
                alertTypeId: parseInt(formData.alertTypeId, 10),
                alertSeverity: parseInt(formData.alertSeverity, 10),
                alertDetails: formData.alertDetails.trim(),
                surfaceMode: formData.showInHeader ? 'push' : 'context',
                expiresAt: formData.expiresAt || '',
                escalateAt: formData.escalateAt || '',
            };
            await (isEditMode ? putJSON(url, body) : postJSON(url, body));

            toast.success(`Alert ${isEditMode ? 'updated' : 'created'} successfully`);
            notifyTasksChanged();

            // Reset form
            setFormData({
                alertTypeId: '',
                alertSeverity: '2',
                alertDetails: '',
                expiresAt: '',
                escalateAt: '',
                showInHeader: false,
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
            toast.error(httpErrorMessage(error, `Failed to ${isEditMode ? 'update' : 'create'} alert`));
        } finally {
            setLoading(false);
        }
    };

    // Handle cancel
    const handleCancel = () => {
        setFormData({
            alertTypeId: '',
            alertSeverity: '2',
            alertDetails: '',
            expiresAt: '',
            escalateAt: '',
            showInHeader: false,
        });
        setErrors({});
        onClose();
    };

    // Handle overlay click
    return (
        <Modal
            isOpen={isOpen}
            onClose={handleCancel}
            contentClassName="modal-content alert-modal"
            ariaLabelledBy="alert-modal-title"
        >
                <ModalHeader
                    variant="warning"
                    titleId="alert-modal-title"
                    icon={<i className="fas fa-exclamation-triangle" />}
                    title={isEditMode ? 'Edit Alert' : 'Add New Alert'}
                    onClose={handleCancel}
                    closeLabel="Close modal"
                />

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
                                    <option key={type.alert_type_id} value={type.alert_type_id}>
                                        {type.type_name}
                                    </option>
                                ))}
                            </select>
                            {errors.alertTypeId && (
                                <span className="error-message">{errors.alertTypeId}</span>
                            )}
                        </div>

                        {/* Severity */}
                        <div className="form-group">
                            <span>
                                Severity Level <span className="required">*</span>
                            </span>
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

                        {/* Dual-surface options — when/whether this alert also reaches the header */}
                        <div className="form-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    name="showInHeader"
                                    checked={formData.showInHeader}
                                    onChange={(e) => setFormData(prev => ({ ...prev, showInHeader: e.target.checked }))}
                                    disabled={loading}
                                />
                                {' '}Also show in the header Tasks bell
                            </label>
                        </div>

                        <div className="form-group">
                            <label htmlFor="escalateAt">Escalate to header on <span className="optional-hint">(optional)</span></label>
                            <input
                                type="date"
                                id="escalateAt"
                                name="escalateAt"
                                value={formData.escalateAt}
                                onChange={handleChange}
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="expiresAt">Expires <span className="optional-hint">(optional)</span></label>
                            <input
                                type="date"
                                id="expiresAt"
                                name="expiresAt"
                                value={formData.expiresAt}
                                onChange={handleChange}
                                disabled={loading}
                            />
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
        </Modal>
    );
};

export default AlertModal;
