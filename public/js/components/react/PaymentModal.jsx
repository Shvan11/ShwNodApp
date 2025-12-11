import React, { useState, useEffect, useCallback } from 'react'
import '../../../css/components/invoice-form.css'
import { parseFormattedNumber } from '../../utils/formatters.js'
import { useToast } from '../../contexts/ToastContext.jsx'

/**
 * Payment Modal Component
 * Memoized to prevent unnecessary re-renders
 * Re-renders only when workData, onClose, or onSuccess props change
 * Uses useCallback for event handlers to prevent breaking memoization
 */
const PaymentModal = ({ workData, onClose, onSuccess }) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [exchangeRate, setExchangeRate] = useState(null);
    const [exchangeRateError, setExchangeRateError] = useState(false);
    const [showRateInput, setShowRateInput] = useState(false);
    const [newRateValue, setNewRateValue] = useState('');
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const [completeWorkData, setCompleteWorkData] = useState(null);

    // Entry mode: 'amount' = enter amount first (current), 'cash' = enter cash first (reverse)
    const [entryMode, setEntryMode] = useState('amount');
    // Track if mode has been locked (after first input or manual toggle)
    const [modeLocked, setModeLocked] = useState(false);

    // Form state - numeric values for calculations
    const [formData, setFormData] = useState({
        paymentDate: new Date().toISOString().substring(0, 10),
        paymentCurrency: 'IQD', // 'USD', 'IQD', 'MIXED'
        amountToRegister: '', // Amount in account currency
        actualUSD: '',
        actualIQD: '',
        change: 0,
        changeManualOverride: false
    });

    // Display state - formatted strings for display
    const [displayValues, setDisplayValues] = useState({
        amountToRegister: '',
        actualUSD: '',
        actualIQD: '',
        change: '',
        newRateValue: ''
    });

    // Calculations and suggestions
    const [calculations, setCalculations] = useState({
        accountCurrency: 'IQD',
        remainingBalance: 0,
        suggestedUSD: 0,
        suggestedIQD: 0,
        calculatedChange: 0,
        totalReceived: 0,
        isShort: false,
        isExact: false,
        isOver: false
    });

    useEffect(() => {
        // Fetch complete work data from V_Report view
        const fetchCompleteWorkData = async () => {
            if (workData && workData.workid) {
                try {
                    const response = await fetch(`/api/getworkforreceipt/${workData.workid}`);
                    if (response.ok) {
                        const data = await response.json();
                        setCompleteWorkData(data);
                    }
                } catch (error) {
                    console.error('Error fetching complete work data:', error);
                }
            }
        };

        fetchCompleteWorkData();
    }, [workData]);

    useEffect(() => {
        // Only initialize form data if not in payment success mode
        if (workData && !paymentSuccess) {
            initializeFormData();
        }
    }, [workData, paymentSuccess]);

    useEffect(() => {
        if (formData.paymentDate) {
            loadExchangeRate(formData.paymentDate);
        }
    }, [formData.paymentDate]);

    // Recalculate when payment currency or amount changes, or when switching to amount mode
    useEffect(() => {
        if (entryMode === 'amount' && formData.amountToRegister && exchangeRate) {
            calculateSuggestedCash();
        }
    }, [formData.amountToRegister, formData.paymentCurrency, exchangeRate, entryMode]);

    // Recalculate when actual cash amounts change
    useEffect(() => {
        if (exchangeRate) {
            calculateTotalAndChange();
        }
    }, [formData.actualUSD, formData.actualIQD, formData.amountToRegister, exchangeRate]);

    // Auto-format display values when formData changes (handles auto-population)
    useEffect(() => {
        setDisplayValues(prev => ({
            ...prev,
            amountToRegister: formatNumber(formData.amountToRegister),
            actualUSD: formatNumber(formData.actualUSD),
            actualIQD: formatNumber(formData.actualIQD),
            change: formatNumber(formData.change)
        }));
    }, [formData.amountToRegister, formData.actualUSD, formData.actualIQD, formData.change]);

    // Auto-format exchange rate input
    useEffect(() => {
        setDisplayValues(prev => ({
            ...prev,
            newRateValue: formatNumber(newRateValue)
        }));
    }, [newRateValue]);

    const loadExchangeRate = async (date) => {
        try {
            const response = await fetch(`/api/getExchangeRateForDate?date=${date}`);
            const result = await response.json();

            if (result.status === 'success' && result.exchangeRate) {
                setExchangeRate(result.exchangeRate);
                setExchangeRateError(false);
            } else {
                setExchangeRate(null);
                setExchangeRateError(true);
            }
        } catch (error) {
            console.error('Error loading exchange rate:', error);
            setExchangeRate(null);
            setExchangeRateError(true);
        }
    };

    const handleSetExchangeRate = async () => {
        const rate = parseFormattedNumber(newRateValue);
        if (!rate || rate <= 0) {
            toast.warning('Please enter a valid exchange rate');
            return;
        }

        try {
            setLoading(true);
            const response = await fetch('/api/updateExchangeRateForDate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: formData.paymentDate,
                    exchangeRate: Math.round(rate)
                })
            });

            const result = await response.json();

            if (result.status === 'success') {
                setExchangeRate(Math.round(rate));
                setExchangeRateError(false);
                setShowRateInput(false);
                setNewRateValue('');
            } else {
                toast.error('Error setting exchange rate: ' + result.message);
            }
        } catch (error) {
            console.error('Error setting exchange rate:', error);
            toast.error('Error setting exchange rate: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const initializeFormData = () => {
        const remainingBalance = (workData.TotalRequired || 0) - (workData.TotalPaid || 0);
        const accountCurrency = workData.Currency || 'IQD';

        setCalculations(prev => ({
            ...prev,
            accountCurrency: accountCurrency,
            remainingBalance: remainingBalance
        }));

        setFormData(prev => ({
            ...prev,
            paymentCurrency: accountCurrency, // Default to account currency
            amountToRegister: ''
        }));
    };

    const calculateSuggestedCash = () => {
        if (!exchangeRate) return;

        const amountToRegister = parseFloat(formData.amountToRegister) || 0;
        const accountCurrency = calculations.accountCurrency;
        const paymentCurrency = formData.paymentCurrency;

        if (paymentCurrency === 'MIXED') {
            // For mixed, no suggestion - user must enter manually
            setCalculations(prev => ({
                ...prev,
                suggestedUSD: 0,
                suggestedIQD: 0
            }));
            return;
        }

        // Single currency payment
        let suggestedUSD = 0;
        let suggestedIQD = 0;

        if (paymentCurrency === 'USD') {
            if (accountCurrency === 'USD') {
                suggestedUSD = amountToRegister;
            } else {
                // Account is IQD, paying in USD - Round UP to collect more
                suggestedUSD = Math.ceil(amountToRegister / exchangeRate);
            }
        } else if (paymentCurrency === 'IQD') {
            if (accountCurrency === 'IQD') {
                suggestedIQD = amountToRegister;
            } else {
                // Account is USD, paying in IQD - Round UP to nearest 1000 to collect more
                suggestedIQD = Math.ceil(amountToRegister * exchangeRate / 1000) * 1000;
            }
        }

        // Auto-fill suggested amounts
        setFormData(prev => ({
            ...prev,
            actualUSD: suggestedUSD || '',
            actualIQD: suggestedIQD || ''
        }));

        setCalculations(prev => ({
            ...prev,
            suggestedUSD,
            suggestedIQD
        }));
    };

    const calculateTotalAndChange = () => {
        if (!exchangeRate) return;

        const actualUSD = parseFloat(formData.actualUSD) || 0;
        const actualIQD = parseFloat(formData.actualIQD) || 0;
        const amountToRegister = parseFloat(formData.amountToRegister) || 0;
        const accountCurrency = calculations.accountCurrency;

        // Convert total received to account currency - Round DOWN what patient gave (you benefit)
        let totalInAccountCurrency;
        if (accountCurrency === 'USD') {
            // Patient gave IQD, convert to USD - Round DOWN
            const iqdValueInUSD = Math.floor(actualIQD / exchangeRate);
            totalInAccountCurrency = actualUSD + iqdValueInUSD;
        } else {
            // Patient gave USD, convert to IQD - Round DOWN to nearest 1000
            const usdValueInIQD = Math.floor(actualUSD * exchangeRate / 1000) * 1000;
            totalInAccountCurrency = usdValueInIQD + actualIQD;
        }

        // Calculate overpayment
        const overpayment = totalInAccountCurrency - amountToRegister;

        // Convert overpayment to IQD (change always in IQD) - Round DOWN to nearest 1000 (you give less)
        let changeInIQD = 0;
        if (overpayment > 0) {
            if (accountCurrency === 'USD') {
                changeInIQD = Math.floor(overpayment * exchangeRate / 1000) * 1000;
            } else {
                changeInIQD = Math.floor(overpayment / 1000) * 1000;
            }
        }

        // Update change only if not manually overridden
        if (!formData.changeManualOverride) {
            setFormData(prev => ({
                ...prev,
                change: changeInIQD
            }));
        }

        setCalculations(prev => ({
            ...prev,
            totalReceived: Math.round(totalInAccountCurrency),
            calculatedChange: changeInIQD,
            isShort: totalInAccountCurrency < amountToRegister,
            isExact: Math.abs(totalInAccountCurrency - amountToRegister) < 0.01,
            isOver: totalInAccountCurrency > amountToRegister
        }));
    };

    // Calculate amount to register from cash received (reverse mode)
    // Uses same "benefit from conversion" rounding - round DOWN what patient gave
    const calculateAmountFromCash = useCallback(() => {
        if (!exchangeRate) return;

        const actualUSD = parseFloat(formData.actualUSD) || 0;
        const actualIQD = parseFloat(formData.actualIQD) || 0;
        const accountCurrency = calculations.accountCurrency;

        // Must have at least one currency to calculate
        if (actualUSD === 0 && actualIQD === 0) {
            setFormData(prev => ({ ...prev, amountToRegister: '' }));
            return;
        }

        // Round DOWN what patient gave (business benefits from conversion)
        let amountToRegister;
        if (accountCurrency === 'USD') {
            // Patient gave IQD, convert to USD - Round DOWN
            const iqdValueInUSD = Math.floor(actualIQD / exchangeRate);
            amountToRegister = actualUSD + iqdValueInUSD;
        } else {
            // Patient gave USD, convert to IQD - Round DOWN to nearest 1000
            const usdValueInIQD = Math.floor(actualUSD * exchangeRate / 1000) * 1000;
            amountToRegister = usdValueInIQD + actualIQD;
        }

        setFormData(prev => ({ ...prev, amountToRegister }));
    }, [exchangeRate, formData.actualUSD, formData.actualIQD, calculations.accountCurrency]);

    // Reverse mode: Calculate amount from cash when in cash entry mode
    useEffect(() => {
        if (entryMode === 'cash' && exchangeRate) {
            calculateAmountFromCash();
        }
    }, [formData.actualUSD, formData.actualIQD, entryMode, exchangeRate, calculateAmountFromCash]);

    // Smart calculation for mixed payments
    const handleMixedUSDChange = (value) => {
        const usd = parseFormattedNumber(value) || 0;

        // Auto-detect mode for mixed payments (only if not locked)
        if (!modeLocked && usd > 0 && !formData.amountToRegister) {
            setEntryMode('cash');
            setModeLocked(true);
        }

        setFormData(prev => ({ ...prev, actualUSD: usd }));
        setDisplayValues(prev => ({ ...prev, actualUSD: value }));

        // Only calculate suggestions in amount mode
        if (entryMode === 'amount' && usd > 0 && !formData.actualIQD && exchangeRate) {
            // Calculate remaining IQD needed
            const amountToRegister = parseFloat(formData.amountToRegister) || 0;
            const accountCurrency = calculations.accountCurrency;

            // Round DOWN what patient gave (you benefit)
            let usdValueInAccount = accountCurrency === 'USD'
                ? usd
                : Math.floor(usd * exchangeRate / 1000) * 1000;
            let remainingInAccount = amountToRegister - usdValueInAccount;

            if (remainingInAccount > 0) {
                // Round UP what patient owes (you benefit)
                let neededIQD = accountCurrency === 'USD'
                    ? Math.ceil(remainingInAccount * exchangeRate / 1000) * 1000
                    : Math.ceil(remainingInAccount / 1000) * 1000;

                setCalculations(prev => ({
                    ...prev,
                    suggestedIQD: neededIQD
                }));
            }
        }
    };

    const handleMixedIQDChange = (value) => {
        const iqd = parseFormattedNumber(value) || 0;

        // Auto-detect mode for mixed payments (only if not locked)
        if (!modeLocked && iqd > 0 && !formData.amountToRegister) {
            setEntryMode('cash');
            setModeLocked(true);
        }

        setFormData(prev => ({ ...prev, actualIQD: iqd }));
        setDisplayValues(prev => ({ ...prev, actualIQD: value }));

        // Only calculate suggestions in amount mode
        if (entryMode === 'amount' && iqd > 0 && !formData.actualUSD && exchangeRate) {
            // Calculate remaining USD needed
            const amountToRegister = parseFloat(formData.amountToRegister) || 0;
            const accountCurrency = calculations.accountCurrency;

            // Round DOWN what patient gave (you benefit)
            let iqdValueInAccount = accountCurrency === 'IQD'
                ? iqd
                : Math.floor(iqd / exchangeRate);
            let remainingInAccount = amountToRegister - iqdValueInAccount;

            if (remainingInAccount > 0) {
                // Round UP what patient owes (you benefit)
                let neededUSD = accountCurrency === 'IQD'
                    ? Math.ceil(remainingInAccount / exchangeRate)
                    : Math.ceil(remainingInAccount);

                setCalculations(prev => ({
                    ...prev,
                    suggestedUSD: neededUSD
                }));
            }
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;

        // When changing payment currency, clear the irrelevant cash field
        if (name === 'paymentCurrency') {
            if (value === 'USD') {
                // Switching to USD only - clear IQD
                setFormData(prev => ({ ...prev, paymentCurrency: value, actualIQD: '' }));
                setDisplayValues(prev => ({ ...prev, actualIQD: '' }));
                return;
            } else if (value === 'IQD') {
                // Switching to IQD only - clear USD
                setFormData(prev => ({ ...prev, paymentCurrency: value, actualUSD: '' }));
                setDisplayValues(prev => ({ ...prev, actualUSD: '' }));
                return;
            }
            // For MIXED, keep both values
        }

        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // Handle formatted money input changes with auto-detect mode (only before mode is locked)
    const handleMoneyInputChange = (fieldName, value) => {
        // Parse the formatted input
        const numericValue = parseFormattedNumber(value);

        // Auto-detect entry mode ONLY if mode is not locked yet
        if (!modeLocked && numericValue > 0) {
            if (fieldName === 'amountToRegister') {
                // User typed in amount field first - lock to amount mode
                setEntryMode('amount');
                setModeLocked(true);
            } else if ((fieldName === 'actualUSD' || fieldName === 'actualIQD') && !formData.amountToRegister) {
                // User typed in cash field first (with empty amount) - lock to cash mode
                setEntryMode('cash');
                setModeLocked(true);
            }
        }

        // Update formData with numeric value for calculations
        setFormData(prev => ({
            ...prev,
            [fieldName]: numericValue
        }));

        // Update display value immediately (user is typing)
        setDisplayValues(prev => ({
            ...prev,
            [fieldName]: value
        }));
    };

    // Handle blur - ensure proper formatting
    const handleMoneyInputBlur = (fieldName) => {
        const numericValue = formData[fieldName];
        const formatted = formatNumber(numericValue);
        setDisplayValues(prev => ({
            ...prev,
            [fieldName]: formatted
        }));
    };

    // Handle focus - select all text only when value is "0"
    const handleMoneyInputFocus = (e) => {
        // If value is "0", select it so user can immediately type to replace (no cursor confusion)
        if (e.target.value === '0') {
            e.target.select();
        }
    };

    const handleChangeOverride = (value) => {
        const numericValue = parseFormattedNumber(value);
        setFormData(prev => ({
            ...prev,
            change: numericValue,
            changeManualOverride: true
        }));
        setDisplayValues(prev => ({
            ...prev,
            change: value
        }));
    };

    // Handle entry mode toggle change (always locks mode after manual toggle)
    const handleEntryModeChange = (newMode) => {
        if (newMode === entryMode) return;

        // Lock mode after manual toggle
        setModeLocked(true);

        if (newMode === 'cash') {
            // Switching to cash mode
            // Clear amount (auto-calculated in cash mode), keep cash values
            // useEffect will recalculate amount from cash
            setFormData(prev => ({
                ...prev,
                amountToRegister: '',
                change: 0,
                changeManualOverride: false
            }));
            setDisplayValues(prev => ({
                ...prev,
                amountToRegister: '',
                change: ''
            }));
            setEntryMode(newMode);
        } else {
            // Switching to amount mode
            // Clear cash (auto-calculated in amount mode), keep amount value
            // useEffect will recalculate cash from amount
            setFormData(prev => ({
                ...prev,
                actualUSD: '',
                actualIQD: '',
                change: 0,
                changeManualOverride: false
            }));
            setDisplayValues(prev => ({
                ...prev,
                actualUSD: '',
                actualIQD: '',
                change: ''
            }));
            setEntryMode(newMode);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const actualUSD = parseInt(formData.actualUSD) || 0;
        const actualIQD = parseInt(formData.actualIQD) || 0;
        const amountPaid = parseInt(formData.amountToRegister) || 0;

        // Validation based on entry mode
        if (entryMode === 'amount') {
            // Amount mode: Must have amount entered
            if (!amountPaid) {
                toast.warning('Please enter the amount to register');
                return;
            }
        } else {
            // Cash mode: Must have cash entered (amount will be calculated)
            if (actualUSD === 0 && actualIQD === 0) {
                toast.warning('Please enter cash received (USD or IQD)');
                return;
            }
            // In cash mode, amountPaid should have been calculated - validate it exists
            if (!amountPaid) {
                toast.warning('Could not calculate amount to register. Please check cash amounts.');
                return;
            }
        }

        if (actualUSD === 0 && actualIQD === 0) {
            toast.warning('Please enter at least one currency amount received');
            return;
        }

        if (calculations.isShort) {
            const confirm = window.confirm('Patient has not paid enough. Amount received is less than amount to register. Continue anyway?');
            if (!confirm) return;
        }

        // Determine if same-currency payment
        const isSameCurrencyPayment =
            (calculations.accountCurrency === 'USD' && actualUSD > 0 && actualIQD === 0) ||
            (calculations.accountCurrency === 'IQD' && actualIQD > 0 && actualUSD === 0);

        // For same-currency: Force change to NULL (not tracked)
        // For cross-currency: Use the change value (can be 0 or positive)
        const changeToSubmit = isSameCurrencyPayment ? null : (parseInt(formData.change) || 0);

        // Validate cross-currency change doesn't exceed received amounts
        if (!isSameCurrencyPayment && changeToSubmit > 0) {
            // Simple case: IQD only payment
            if (actualUSD === 0 && changeToSubmit > actualIQD) {
                toast.error(`Invalid Change: ${changeToSubmit} IQD cannot exceed IQD received (${actualIQD} IQD)`);
                return;
            }
        }

        try {
            setLoading(true);

            const invoiceData = {
                workid: workData.workid,
                amountPaid: amountPaid,
                paymentDate: formData.paymentDate,
                usdReceived: actualUSD,
                iqdReceived: actualIQD,
                change: changeToSubmit  // NULL for same-currency, number for cross-currency
            };

            const response = await fetch('/api/addInvoice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(invoiceData)
            });

            const result = await response.json();

            if (result.status === 'success') {
                // Set success state and prepare receipt data with complete work data
                setPaymentSuccess(true);
                setReceiptData({
                    ...workData,
                    // Override with complete data from V_Report if available
                    ...(completeWorkData || {}),
                    amountPaidToday: amountPaid,
                    paymentDate: formData.paymentDate,
                    paymentDateTime: new Date().toISOString(),
                    usdReceived: actualUSD,
                    iqdReceived: actualIQD,
                    change: parseInt(formData.change) || 0,
                    newBalance: (workData.TotalRequired - workData.TotalPaid - amountPaid)
                });

                if (onSuccess) {
                    onSuccess(result);
                }
            } else {
                toast.error('Error adding payment: ' + result.message);
            }
        } catch (error) {
            console.error('Error adding payment:', error);
            toast.error('Error adding payment: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async () => {
        try {
            // Fetch receipt HTML from template-based system using work ID
            const response = await fetch(`/api/templates/receipt/work/${workData.workid}`);
            if (!response.ok) throw new Error('Failed to generate receipt');

            const html = await response.text();

            // Create print window
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            if (!printWindow) {
                throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
            }

            // Write content
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();

            // Wait for load then print
            printWindow.onload = function() {
                printWindow.focus();
                printWindow.print();
            };

            // Auto-send WhatsApp receipt (non-blocking)
            console.log('📱 [PAYMENT MODAL] Starting WhatsApp send for work:', workData.workid);
            fetch('/api/wa/send-receipt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: workData.workid })
            })
            .then(res => {
                console.log('📱 [PAYMENT MODAL] Response status:', res.status);
                return res.json();
            })
            .then(result => {
                console.log('📱 [PAYMENT MODAL] Response data:', result);
                if (result.success) {
                    toast.success('Receipt sent via WhatsApp!', 3000);
                    console.log('✅ [PAYMENT MODAL] Success toast shown');
                } else {
                    toast.warning(result.message || 'Failed to send WhatsApp', 3000);
                    console.warn('⚠️ [PAYMENT MODAL] Warning:', result.message);
                }
            })
            .catch(err => {
                toast.error('WhatsApp error: ' + err.message, 3000);
                console.error('❌ [PAYMENT MODAL] Network error:', err);
            });
        } catch (err) {
            console.error('Error printing receipt:', err);
            toast.error(`Failed to print receipt: ${err.message}`);
        }
    };

    const handleCloseAfterSuccess = () => {
        setPaymentSuccess(false);
        setReceiptData(null);
        onClose();
    };

    const formatCurrency = (amount, currency) => {
        if (isNaN(amount) || amount === null || amount === undefined) {
            return `0 ${currency}`;
        }
        // Use toLocaleString with 'en-US' for comma separators
        return `${Math.round(amount).toLocaleString('en-US')} ${currency}`;
    };

    const formatNumber = (num) => {
        if (isNaN(num) || num === null || num === undefined) {
            return '0';
        }
        return Math.round(num).toLocaleString('en-US');
    };

    if (!workData) return null;

    // Detect same-currency payment for UI display (based on selected payment currency)
    // Note: In handleSubmit, we recalculate based on actual values entered for validation
    const isSameCurrencyPayment =
        (calculations.accountCurrency === 'USD' && formData.paymentCurrency === 'USD') ||
        (calculations.accountCurrency === 'IQD' && formData.paymentCurrency === 'IQD');

    return (
        <>
            <div className="modal-overlay">
                <div className="modal-content invoice-modal payment-modal-compact">
                <button className="modal-close" onClick={paymentSuccess ? handleCloseAfterSuccess : onClose}>×</button>

                {!paymentSuccess ? (
                    <>
                        {/* Compact Header with Balance Info */}
                        <div className="payment-header-compact">
                            <div className="payment-header-left">
                                <h2 className="payment-title-compact">
                                    <i className="fas fa-credit-card"></i>
                                    Add Payment
                                </h2>
                                <span className="payment-work-type">{workData.TypeName || `Work #${workData.workid}`}</span>
                            </div>
                            <div className="payment-header-right">
                                <div className="payment-balance-badge">
                                    <span className="balance-label">Balance</span>
                                    <span className="balance-amount">{formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Exchange Rate - Compact Inline */}
                        {exchangeRateError && !exchangeRate ? (
                            <div className="exchange-rate-error-compact">
                                <i className="fas fa-exclamation-triangle"></i>
                                <span>No rate for {formData.paymentDate}</span>
                                {!showRateInput ? (
                                    <button type="button" onClick={() => setShowRateInput(true)} className="btn-link">
                                        Set Rate
                                    </button>
                                ) : (
                                    <div className="rate-input-inline">
                                        <input
                                            type="text"
                                            value={displayValues.newRateValue}
                                            onChange={(e) => {
                                                setNewRateValue(e.target.value);
                                                setDisplayValues(prev => ({ ...prev, newRateValue: e.target.value }));
                                            }}
                                            placeholder="1,406"
                                            className="rate-input-small"
                                        />
                                        <button type="button" onClick={handleSetExchangeRate} disabled={loading} className="btn-sm btn-primary">
                                            {loading ? '...' : 'Save'}
                                        </button>
                                        <button type="button" onClick={() => { setShowRateInput(false); setNewRateValue(''); }} className="btn-sm btn-ghost">
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : exchangeRate ? (
                            <div className="exchange-rate-compact">
                                <i className="fas fa-exchange-alt"></i>
                                <span>1 USD = {formatNumber(exchangeRate)} IQD</span>
                                <span className="rate-date">({formData.paymentDate})</span>
                            </div>
                        ) : null}

                        <form onSubmit={handleSubmit} className="invoice-form payment-form-compact">
                            {/* Row 1: Currency + Entry Mode + Date */}
                            <div className="payment-row-compact">
                                <div className="payment-field">
                                    <label>Payment Currency</label>
                                    <select
                                        name="paymentCurrency"
                                        value={formData.paymentCurrency}
                                        onChange={handleInputChange}
                                        className="select-compact"
                                    >
                                        <option value="USD">USD Only</option>
                                        <option value="IQD">IQD Only</option>
                                        <option value="MIXED">Mixed</option>
                                    </select>
                                </div>

                                <div className="payment-field entry-mode-field">
                                    <label>Entry Mode</label>
                                    <div className="entry-mode-toggle">
                                        <span className={`toggle-label ${entryMode === 'amount' ? 'active' : ''}`}>Amount</span>
                                        <label className="entry-mode-switch">
                                            <input
                                                type="checkbox"
                                                checked={entryMode === 'cash'}
                                                onChange={(e) => handleEntryModeChange(e.target.checked ? 'cash' : 'amount')}
                                            />
                                            <span className="slider"></span>
                                        </label>
                                        <span className={`toggle-label ${entryMode === 'cash' ? 'active' : ''}`}>Cash</span>
                                    </div>
                                </div>

                                <div className="payment-field">
                                    <label>Date</label>
                                    <input
                                        type="date"
                                        name="paymentDate"
                                        value={formData.paymentDate}
                                        onChange={handleInputChange}
                                        className="input-compact"
                                    />
                                </div>
                            </div>

                            {/* Row 2: Amount + Cash Received + Change */}
                            <div className="payment-row-compact payment-main-row">
                                {/* Amount to Register */}
                                <div className="payment-field payment-field-lg">
                                    <label>
                                        Amount to Register ({calculations.accountCurrency})
                                        {entryMode === 'amount' && <span className="required">*</span>}
                                        {entryMode === 'cash' && <span className="auto-badge">Auto</span>}
                                    </label>
                                    <input
                                        type="text"
                                        value={displayValues.amountToRegister}
                                        onChange={(e) => handleMoneyInputChange('amountToRegister', e.target.value)}
                                        onBlur={() => handleMoneyInputBlur('amountToRegister')}
                                        onFocus={handleMoneyInputFocus}
                                        readOnly={entryMode === 'cash'}
                                        placeholder={entryMode === 'cash' ? 'Auto' : 'Enter amount'}
                                        className={`input-lg ${entryMode === 'cash' ? 'input-readonly' : ''}`}
                                    />
                                </div>

                                {/* Cash Received - Dynamic based on currency */}
                                {formData.paymentCurrency !== 'MIXED' ? (
                                    <div className="payment-field payment-field-lg">
                                        <label>
                                            {formData.paymentCurrency} Received
                                            {entryMode === 'cash' && <span className="required">*</span>}
                                            {entryMode === 'amount' && <span className="auto-badge">Auto</span>}
                                        </label>
                                        {formData.paymentCurrency === 'USD' ? (
                                            <input
                                                type="text"
                                                value={displayValues.actualUSD}
                                                onChange={(e) => handleMoneyInputChange('actualUSD', e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualUSD')}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder={entryMode === 'cash' ? 'Enter USD' : 'Auto'}
                                                className="input-lg"
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={displayValues.actualIQD}
                                                onChange={(e) => handleMoneyInputChange('actualIQD', e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualIQD')}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder={entryMode === 'cash' ? 'Enter IQD' : 'Auto'}
                                                className="input-lg"
                                            />
                                        )}
                                        {/* Suggestion hint */}
                                        {entryMode === 'amount' && calculations.suggestedUSD > 0 && formData.paymentCurrency === 'USD' && (
                                            <small className="field-hint">Collect {formatNumber(calculations.suggestedUSD)}</small>
                                        )}
                                        {entryMode === 'amount' && calculations.suggestedIQD > 0 && formData.paymentCurrency === 'IQD' && (
                                            <small className="field-hint">Collect {formatNumber(calculations.suggestedIQD)}</small>
                                        )}
                                    </div>
                                ) : (
                                    /* Mixed Payment - Two smaller fields */
                                    <div className="payment-field-group">
                                        <div className="payment-field">
                                            <label>USD Received</label>
                                            <input
                                                type="text"
                                                value={displayValues.actualUSD}
                                                onChange={(e) => handleMixedUSDChange(e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualUSD')}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder="USD"
                                                className="input-md"
                                            />
                                        </div>
                                        <div className="payment-field">
                                            <label>IQD Received</label>
                                            <input
                                                type="text"
                                                value={displayValues.actualIQD}
                                                onChange={(e) => handleMixedIQDChange(e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualIQD')}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder="IQD"
                                                className="input-md"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Change Field */}
                                <div className="payment-field">
                                    <label>
                                        Change (IQD)
                                        {isSameCurrencyPayment && <span className="na-badge">N/A</span>}
                                    </label>
                                    {isSameCurrencyPayment ? (
                                        <input
                                            type="text"
                                            value="—"
                                            disabled
                                            className="input-compact input-disabled"
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            value={displayValues.change}
                                            onChange={(e) => handleChangeOverride(e.target.value)}
                                            onBlur={() => handleMoneyInputBlur('change')}
                                            onFocus={handleMoneyInputFocus}
                                            placeholder="0"
                                            className="input-compact"
                                        />
                                    )}
                                    {!isSameCurrencyPayment && calculations.calculatedChange > 0 && !formData.changeManualOverride && (
                                        <small className="field-hint success">Auto-calculated</small>
                                    )}
                                </div>
                            </div>

                            {/* Summary Strip - Only show when there's data */}
                            {(formData.actualUSD || formData.actualIQD) && (
                                <div className={`payment-summary-strip ${calculations.isShort ? 'warning' : 'success'}`}>
                                    <div className="summary-item">
                                        <span className="summary-label">Cash IN:</span>
                                        <span className="summary-value">
                                            {formData.actualUSD ? `$${formatNumber(formData.actualUSD)}` : ''}
                                            {formData.actualUSD && formData.actualIQD ? ' + ' : ''}
                                            {formData.actualIQD ? `${formatNumber(formData.actualIQD)} IQD` : ''}
                                        </span>
                                    </div>
                                    {!isSameCurrencyPayment && formData.change > 0 && (
                                        <div className="summary-item">
                                            <span className="summary-label">Change OUT:</span>
                                            <span className="summary-value">{formatNumber(formData.change)} IQD</span>
                                        </div>
                                    )}
                                    <div className="summary-item summary-total">
                                        <span className="summary-label">Register:</span>
                                        <span className="summary-value">{formatCurrency(formData.amountToRegister || 0, calculations.accountCurrency)}</span>
                                    </div>
                                    {calculations.isShort && (
                                        <div className="summary-warning">
                                            <i className="fas fa-exclamation-triangle"></i>
                                            Short by {formatCurrency((formData.amountToRegister || 0) - calculations.totalReceived, calculations.accountCurrency)}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actions - Compact */}
                            <div className="payment-actions-compact">
                                <button type="button" className="btn btn-secondary" onClick={onClose}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={loading || !exchangeRate}>
                                    {loading ? (
                                        <><i className="fas fa-spinner fa-spin"></i> Saving...</>
                                    ) : (
                                        <><i className="fas fa-check"></i> Save Payment</>
                                    )}
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    /* Payment Success State - Compact */
                    <div className="payment-success-compact">
                        <div className="success-icon">
                            <i className="fas fa-check-circle"></i>
                        </div>
                        <h2>Payment Recorded!</h2>
                        <p className="success-amount">
                            {formatCurrency(receiptData?.amountPaidToday || 0, receiptData?.Currency || 'IQD')}
                        </p>
                        <div className="success-actions">
                            <button onClick={handlePrint} className="btn btn-primary">
                                <i className="fas fa-print"></i> Print Receipt
                            </button>
                            <button onClick={handleCloseAfterSuccess} className="btn btn-secondary">
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    );
};

// Memoize the component to prevent unnecessary re-renders
// Only re-renders when workData, onClose, or onSuccess change
export default React.memo(PaymentModal);
