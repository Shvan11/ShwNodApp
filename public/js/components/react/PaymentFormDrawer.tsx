import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { formatNumber } from '../../utils/formatters';

// Types
interface SetInfo {
    SetSequence?: number;
    Balance?: number;
    SetCost?: number;
    TotalPaid?: number;
    Currency?: string;
}

interface WorkInfo {
    workid?: number;
    // Add other work info fields as needed
}

interface PaymentFormData {
    Amountpaid: string | number;
    Dateofpayment: string;
}

interface PaymentSaveData extends PaymentFormData {
    Amountpaid: number;
    ActualAmount: null;
    ActualCur: string;
    Change: null;
}

interface FormErrors {
    Amountpaid?: string | null;
    Dateofpayment?: string | null;
    submit?: string;
}

interface PaymentFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: PaymentSaveData) => Promise<void>;
    set: SetInfo | null;
    workInfo?: WorkInfo;
}

const PaymentFormDrawer = ({ isOpen, onClose, onSave, set, workInfo }: PaymentFormDrawerProps) => {
    const [formData, setFormData] = useState<PaymentFormData>({
        Amountpaid: 0,
        Dateofpayment: new Date().toISOString().split('T')[0]
    });

    const [displayAmount, setDisplayAmount] = useState('');
    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && set) {
            // Reset form when drawer opens
            const initialAmount = set.Balance || set.SetCost || 0;
            setFormData({
                Amountpaid: initialAmount,
                Dateofpayment: new Date().toISOString().split('T')[0]
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
        setFormData(prev => ({ ...prev, Amountpaid: num }));
        if (errors.Amountpaid) {
            setErrors(prev => ({ ...prev, Amountpaid: null }));
        }
    };

    const validate = (): boolean => {
        const newErrors: FormErrors = {};
        const amount = Number(formData.Amountpaid) || 0;

        if (amount <= 0) {
            newErrors.Amountpaid = 'Amount paid is required and must be greater than 0';
        }

        if (!formData.Dateofpayment) {
            newErrors.Dateofpayment = 'Payment date is required';
        }

        if (set && set.Balance && amount > set.Balance) {
            newErrors.Amountpaid = `Amount cannot exceed balance of ${formatNumber(set.Balance)}`;
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
                Amountpaid: Number(formData.Amountpaid),
                ActualAmount: null,
                ActualCur: set?.Currency || 'USD',
                Change: null
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

    const remainingBalance = set?.Balance || set?.SetCost || 0;
    const totalPaid = set?.TotalPaid || 0;
    const newBalance = remainingBalance - (Number(formData.Amountpaid) || 0);
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
                                <span className="value">{formatNumber(set?.SetCost || 0)}</span>
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
                            <label htmlFor="Amountpaid">
                                Amount to Pay <span className="required">*</span>
                            </label>
                            <div className="input-group">
                                <input
                                    type="text"
                                    id="Amountpaid"
                                    name="Amountpaid"
                                    value={displayAmount}
                                    onChange={(e) => handleAmountChange(e.target.value)}
                                    onBlur={() => setDisplayAmount(formData.Amountpaid ? formatNumber(formData.Amountpaid) : '')}
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
                        {Number(formData.Amountpaid) > 0 && (
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
