import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { PaymentSaveData } from '@/types/api.types';
import { formatNumber } from '../../utils/formatters';

// Types
interface SetInfo {
    set_sequence?: number;
    Balance?: number;
    set_cost?: number;
    TotalPaid?: number;
    currency?: string;
}

interface WorkInfo {
    workid?: number;
    // Add other work info fields as needed
}

interface PaymentFormData {
    amount_paid: string | number;
    date_of_payment: string;
}

interface FormErrors {
    amount_paid?: string | null;
    date_of_payment?: string | null;
    submit?: string;
}

interface PaymentFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: PaymentSaveData) => Promise<void>;
    set: SetInfo | null;
    workInfo?: WorkInfo;
}

const PaymentFormDrawer = ({ isOpen, onClose, onSave, set, workInfo: _workInfo }: PaymentFormDrawerProps) => {
    const [formData, setFormData] = useState<PaymentFormData>({
        amount_paid: 0,
        date_of_payment: new Date().toISOString().split('T')[0]
    });

    const [displayAmount, setDisplayAmount] = useState('');
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && set) {
            // Reset form when drawer opens
            const initialAmount = set.Balance || set.set_cost || 0;
            setFormData({
                amount_paid: initialAmount,
                date_of_payment: new Date().toISOString().split('T')[0]
            });
            setDisplayAmount(initialAmount ? formatNumber(initialAmount) : '');
            setErrors({});
        }
    }, [isOpen, set]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));

        // Clear error for this field
        if (errors[name as keyof FormErrors]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }
    };

    // Handle amount input with formatting as you type
    const handleAmountChange = (value: string) => {
        const digits = value.replace(/[^\d]/g, '');
        const num = parseInt(digits, 10) || 0;
        setDisplayAmount(num ? num.toLocaleString('en-US') : '');
        setFormData(prev => ({ ...prev, amount_paid: num }));
        if (errors.amount_paid) {
            setErrors(prev => ({ ...prev, amount_paid: null }));
        }
    };

    const validate = (): boolean => {
        const newErrors: FormErrors = {};
        const amount = Number(formData.amount_paid) || 0;

        if (amount <= 0) {
            newErrors.amount_paid = 'Amount paid is required and must be greater than 0';
        }

        if (!formData.date_of_payment) {
            newErrors.date_of_payment = 'Payment date is required';
        }

        if (set && set.Balance != null && amount > set.Balance) {
            newErrors.amount_paid = `Amount cannot exceed balance of ${formatNumber(set.Balance)}`;
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setSaving(true);

        try {
            await onSave({
                ...formData,
                amount_paid: Number(formData.amount_paid),
                actual_amount: null,
                actual_cur: set?.currency || 'USD',
                change: null
            });
            onClose();
        } catch (error) {
            console.error('Error saving payment:', error);
            setErrors({ submit: (error as Error).message || 'Failed to save payment' });
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const remainingBalance = set?.Balance || set?.set_cost || 0;
    const totalPaid = set?.TotalPaid || 0;
    const newBalance = remainingBalance - (Number(formData.amount_paid) || 0);
    const currency = set?.currency || 'USD';

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
                            <h3>Set #{set?.set_sequence}</h3>
                            <span className="set-currency">{currency}</span>
                        </div>
                        <div className="summary-grid">
                            <div className="summary-item">
                                <span className="label">Set Cost</span>
                                <span className="value">{formatNumber(set?.set_cost || 0)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="label">Total Paid</span>
                                <span className="value">{formatNumber(totalPaid)}</span>
                            </div>
                            <div className="summary-item highlight">
                                <span className="label">Balance Due</span>
                                <span className="value">{formatNumber(remainingBalance)}</span>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="aligner-payment-form">
                        {/* Amount Paid */}
                        <div className="form-field">
                            <label htmlFor="amount_paid">
                                Amount to Pay <span className="required">*</span>
                            </label>
                            <div className="input-group">
                                <input
                                    type="text"
                                    id="amount_paid"
                                    name="amount_paid"
                                    value={displayAmount}
                                    onChange={(e) => handleAmountChange(e.target.value)}
                                    onBlur={() => setDisplayAmount(formData.amount_paid ? formatNumber(formData.amount_paid) : '')}
                                    className={errors.amount_paid ? 'error' : ''}
                                    autoFocus
                                    placeholder="Enter amount"
                                />
                                <span className="currency-badge">{currency}</span>
                            </div>
                            {errors.amount_paid && <span className="error-message">{errors.amount_paid}</span>}
                        </div>

                        {/* Payment Date */}
                        <div className="form-field">
                            <label htmlFor="date_of_payment">
                                Payment Date <span className="required">*</span>
                            </label>
                            <input
                                type="date"
                                id="date_of_payment"
                                name="date_of_payment"
                                value={formData.date_of_payment}
                                onChange={handleChange}
                                className={errors.date_of_payment ? 'error' : ''}
                            />
                            {errors.date_of_payment && <span className="error-message">{errors.date_of_payment}</span>}
                        </div>

                        {/* New Balance Preview */}
                        {Number(formData.amount_paid) > 0 && (
                            <div className="balance-preview">
                                <span className="preview-label">New Balance:</span>
                                <span className={`preview-value ${newBalance <= 0 ? 'paid-full' : ''}`}>
                                    {formatNumber(newBalance)} {currency}
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
