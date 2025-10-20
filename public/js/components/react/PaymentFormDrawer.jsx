import React, { useState, useEffect } from 'react';

const PaymentFormDrawer = ({ isOpen, onClose, onSave, set, workInfo }) => {
    const [formData, setFormData] = useState({
        Amountpaid: '',
        Dateofpayment: new Date().toISOString().split('T')[0],
        ActualAmount: '',
        ActualCur: 'USD',
        Change: ''
    });

    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && set) {
            // Reset form when drawer opens
            setFormData({
                Amountpaid: set.Balance || set.SetCost || '',
                Dateofpayment: new Date().toISOString().split('T')[0],
                ActualAmount: '',
                ActualCur: set.Currency || 'USD',
                Change: ''
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

        // Auto-calculate change
        if (name === 'ActualAmount' || name === 'Amountpaid') {
            const actualAmount = name === 'ActualAmount' ? parseFloat(value) || 0 : parseFloat(formData.ActualAmount) || 0;
            const amountPaid = name === 'Amountpaid' ? parseFloat(value) || 0 : parseFloat(formData.Amountpaid) || 0;
            const change = actualAmount - amountPaid;

            setFormData(prev => ({
                ...prev,
                Change: change > 0 ? change.toFixed(2) : ''
            }));
        }

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
                ActualAmount: formData.ActualAmount ? parseFloat(formData.ActualAmount) : null,
                Change: formData.Change ? parseFloat(formData.Change) : null
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

    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-container" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Add Payment for Set #{set?.SetSequence}</h2>
                    <button className="drawer-close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="drawer-body">
                    {/* Payment Summary */}
                    <div className="payment-summary">
                        <div className="summary-row">
                            <span>Set Cost:</span>
                            <strong>{set?.SetCost || 0} {set?.Currency || 'USD'}</strong>
                        </div>
                        <div className="summary-row">
                            <span>Total Paid:</span>
                            <strong>{totalPaid} {set?.Currency || 'USD'}</strong>
                        </div>
                        <div className="summary-row balance">
                            <span>Remaining Balance:</span>
                            <strong>{remainingBalance} {set?.Currency || 'USD'}</strong>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Amount Paid */}
                        <div className="form-group">
                            <label htmlFor="Amountpaid">
                                Amount Paid <span className="required">*</span>
                            </label>
                            <div className="input-with-currency">
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
                                />
                                <span className="currency-label">{set?.Currency || 'USD'}</span>
                            </div>
                            {errors.Amountpaid && <span className="error-text">{errors.Amountpaid}</span>}
                        </div>

                        {/* Payment Date */}
                        <div className="form-group">
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
                            {errors.Dateofpayment && <span className="error-text">{errors.Dateofpayment}</span>}
                        </div>

                        {/* Actual Amount (Optional - for change calculation) */}
                        <div className="form-group">
                            <label htmlFor="ActualAmount">
                                Actual Amount Received (Optional)
                            </label>
                            <div className="input-with-currency">
                                <input
                                    type="number"
                                    id="ActualAmount"
                                    name="ActualAmount"
                                    value={formData.ActualAmount}
                                    onChange={handleChange}
                                    step="0.01"
                                    min="0"
                                    placeholder="If customer paid more"
                                />
                                <select
                                    name="ActualCur"
                                    value={formData.ActualCur}
                                    onChange={handleChange}
                                    className="currency-select"
                                >
                                    <option value="USD">USD</option>
                                    <option value="IQD">IQD</option>
                                    <option value="EUR">EUR</option>
                                </select>
                            </div>
                        </div>

                        {/* Change (Auto-calculated) */}
                        {formData.Change && parseFloat(formData.Change) > 0 && (
                            <div className="form-group">
                                <label>Change to Return</label>
                                <div className="change-display">
                                    <i className="fas fa-coins"></i>
                                    <strong>{formData.Change} {formData.ActualCur}</strong>
                                </div>
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
                                <i className="fas fa-save"></i>
                                Add Payment
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentFormDrawer;
