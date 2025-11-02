import { useState, useEffect } from 'react';

const PaymentFormDrawer = ({ isOpen, onClose, onSave, set, workInfo }) => {
    const [formData, setFormData] = useState({
        Amountpaid: '',
        Dateofpayment: new Date().toISOString().split('T')[0]
    });

    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && set) {
            // Reset form when drawer opens
            setFormData({
                Amountpaid: set.Balance || set.SetCost || '',
                Dateofpayment: new Date().toISOString().split('T')[0]
            });
            setErrors({});
        }
    }, [isOpen, set]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));

        // Clear error for this field
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }
    };

    const validate = () => {
        const newErrors = {};

        if (!formData.Amountpaid || parseFloat(formData.Amountpaid) <= 0) {
            newErrors.Amountpaid = 'Amount paid is required and must be greater than 0';
        }

        if (!formData.Dateofpayment) {
            newErrors.Dateofpayment = 'Payment date is required';
        }

        if (set && set.Balance && parseFloat(formData.Amountpaid) > set.Balance) {
            newErrors.Amountpaid = `Amount cannot exceed balance of ${set.Balance}`;
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setSaving(true);

        try {
            await onSave({
                ...formData,
                Amountpaid: parseFloat(formData.Amountpaid),
                ActualAmount: null,
                ActualCur: set?.Currency || 'USD',
                Change: null
            });
            onClose();
        } catch (error) {
            console.error('Error saving payment:', error);
            setErrors({ submit: error.message || 'Failed to save payment' });
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const remainingBalance = set?.Balance || set?.SetCost || 0;
    const totalPaid = set?.TotalPaid || 0;
    const newBalance = remainingBalance - (parseFloat(formData.Amountpaid) || 0);
    const currency = set?.Currency || 'USD';

    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-container aligner-payment-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Add Payment</h2>
                    <button className="drawer-close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="drawer-body">
                    {/* Payment Summary */}
                    <div className="aligner-payment-summary">
                        <div className="summary-header">
                            <h3>Set #{set?.SetSequence}</h3>
                            <span className="set-currency">{currency}</span>
                        </div>
                        <div className="summary-grid">
                            <div className="summary-item">
                                <span className="label">Set Cost</span>
                                <span className="value">{set?.SetCost || 0}</span>
                            </div>
                            <div className="summary-item">
                                <span className="label">Total Paid</span>
                                <span className="value">{totalPaid}</span>
                            </div>
                            <div className="summary-item highlight">
                                <span className="label">Balance Due</span>
                                <span className="value">{remainingBalance}</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="aligner-payment-form">
                        {/* Amount Paid */}
                        <div className="form-field">
                            <label htmlFor="Amountpaid">
                                Amount to Pay <span className="required">*</span>
                            </label>
                            <div className="input-group">
                                <input
                                    type="number"
                                    id="Amountpaid"
                                    name="Amountpaid"
                                    value={formData.Amountpaid}
                                    onChange={handleChange}
                                    step="0.01"
                                    min="0.01"
                                    className={errors.Amountpaid ? 'error' : ''}
                                    autoFocus
                                    placeholder="Enter amount"
                                />
                                <span className="currency-badge">{currency}</span>
                            </div>
                            {errors.Amountpaid && <span className="error-message">{errors.Amountpaid}</span>}
                        </div>

                        {/* Payment Date */}
                        <div className="form-field">
                            <label htmlFor="Dateofpayment">
                                Payment Date <span className="required">*</span>
                            </label>
                            <input
                                type="date"
                                id="Dateofpayment"
                                name="Dateofpayment"
                                value={formData.Dateofpayment}
                                onChange={handleChange}
                                className={errors.Dateofpayment ? 'error' : ''}
                            />
                            {errors.Dateofpayment && <span className="error-message">{errors.Dateofpayment}</span>}
                        </div>

                        {/* New Balance Preview */}
                        {formData.Amountpaid && (
                            <div className="balance-preview">
                                <span className="preview-label">New Balance:</span>
                                <span className={`preview-value ${newBalance <= 0 ? 'paid-full' : ''}`}>
                                    {newBalance.toFixed(2)} {currency}
                                </span>
                                {newBalance <= 0 && <span className="badge-success">Fully Paid</span>}
                            </div>
                        )}

                        {errors.submit && (
                            <div className="error-alert">
                                <i className="fas fa-exclamation-circle"></i>
                                {errors.submit}
                            </div>
                        )}
                    </form>
                </div>

                <div className="drawer-footer">
                    <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="btn-submit"
                        onClick={handleSubmit}
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
                                Save Payment
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentFormDrawer;
