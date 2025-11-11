import { useState, useEffect } from 'react'
import '../../../css/components/invoice-form.css'
import { formatNumber, parseFormattedNumber, formatCurrency as formatCurrencyUtil } from '../../utils/formatters.js'

const PaymentModal = ({ workData, onClose, onSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [exchangeRate, setExchangeRate] = useState(null);
    const [exchangeRateError, setExchangeRateError] = useState(false);
    const [showRateInput, setShowRateInput] = useState(false);
    const [newRateValue, setNewRateValue] = useState('');
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const [completeWorkData, setCompleteWorkData] = useState(null);

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

    // Recalculate when payment currency or amount changes
    useEffect(() => {
        if (formData.amountToRegister && exchangeRate) {
            calculateSuggestedCash();
        }
    }, [formData.amountToRegister, formData.paymentCurrency, exchangeRate]);

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
            alert('Please enter a valid exchange rate');
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
                alert('Error setting exchange rate: ' + result.message);
            }
        } catch (error) {
            console.error('Error setting exchange rate:', error);
            alert('Error setting exchange rate: ' + error.message);
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

    // Smart calculation for mixed payments
    const handleMixedUSDChange = (value) => {
        const usd = parseFormattedNumber(value) || 0;
        setFormData(prev => ({ ...prev, actualUSD: usd }));
        setDisplayValues(prev => ({ ...prev, actualUSD: value }));

        if (usd > 0 && !formData.actualIQD && exchangeRate) {
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
        setFormData(prev => ({ ...prev, actualIQD: iqd }));
        setDisplayValues(prev => ({ ...prev, actualIQD: value }));

        if (iqd > 0 && !formData.actualUSD && exchangeRate) {
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
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // Handle formatted money input changes
    const handleMoneyInputChange = (fieldName, value) => {
        // Parse the formatted input
        const numericValue = parseFormattedNumber(value);

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

    // Handle focus - allow easy editing
    const handleMoneyInputFocus = (fieldName) => {
        // Keep the formatted value, user can edit it
        // The parseFormattedNumber will handle comma removal
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

    const handleSubmit = async (e) => {
        e.preventDefault();

        const actualUSD = parseInt(formData.actualUSD) || 0;
        const actualIQD = parseInt(formData.actualIQD) || 0;
        const amountPaid = parseInt(formData.amountToRegister) || 0;

        if (!amountPaid) {
            alert('Please enter the amount to register');
            return;
        }

        if (actualUSD === 0 && actualIQD === 0) {
            alert('Please enter at least one currency amount received');
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
                alert(`⚠️ Invalid Change\n\nChange (${changeToSubmit} IQD) cannot exceed IQD received (${actualIQD} IQD)`);
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
                alert('Error adding payment: ' + result.message);
            }
        } catch (error) {
            console.error('Error adding payment:', error);
            alert('Error adding payment: ' + error.message);
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
        } catch (err) {
            console.error('Error printing receipt:', err);
            alert(`Failed to print receipt: ${err.message}`);
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

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!workData) return null;

    return (
        <>
            <div className="modal-overlay">
                <div className="modal-content invoice-modal">
                <button className="modal-close" onClick={paymentSuccess ? handleCloseAfterSuccess : onClose}>×</button>

                {!paymentSuccess ? (
                    <>
                        <h2 className="modal-title">
                            Add Payment - {workData.TypeName || `Work #${workData.workid}`}
                        </h2>

                <div className="modal-description" style={{
                    padding: '0 24px 20px',
                    fontSize: '14px',
                    color: '#6b7280'
                }}>
                    <strong>Account Currency:</strong> {calculations.accountCurrency} |
                    <strong> Balance:</strong> {formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}
                </div>

                {/* Top Actions - Redundant buttons for convenience */}
                <div className="form-actions" style={{ margin: '0 24px 20px', paddingTop: '0' }}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        disabled={loading || !exchangeRate}
                        onClick={(e) => {
                            e.preventDefault();
                            // Find and trigger the main form submit
                            const form = document.querySelector('.invoice-form');
                            if (form) {
                                form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                            }
                        }}
                    >
                        {loading ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                Save Payment
                            </>
                        )}
                    </button>
                </div>

                {/* Exchange Rate Status */}
                {exchangeRateError && !exchangeRate ? (
                    <div style={{
                        background: '#fef2f2',
                        border: '2px solid #ef4444',
                        borderRadius: '8px',
                        padding: '16px',
                        margin: '0 24px 24px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#dc2626' }}>
                            <i className="fas fa-exclamation-triangle" style={{ fontSize: '20px' }}></i>
                            <strong>Exchange rate not set for {formData.paymentDate}</strong>
                        </div>
                        {!showRateInput ? (
                            <button
                                type="button"
                                onClick={() => setShowRateInput(true)}
                                style={{
                                    padding: '10px 20px',
                                    background: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '600',
                                    fontSize: '14px'
                                }}
                            >
                                <i className="fas fa-plus"></i> Set Exchange Rate
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={displayValues.newRateValue}
                                    onChange={(e) => {
                                        setNewRateValue(e.target.value);
                                        setDisplayValues(prev => ({ ...prev, newRateValue: e.target.value }));
                                    }}
                                    onBlur={() => {
                                        const formatted = formatNumber(newRateValue);
                                        setDisplayValues(prev => ({ ...prev, newRateValue: formatted }));
                                    }}
                                    placeholder="Enter rate (e.g., 1,406)"
                                    style={{
                                        flex: 1,
                                        padding: '10px',
                                        border: '2px solid #dc2626',
                                        borderRadius: '6px',
                                        fontSize: '14px'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={handleSetExchangeRate}
                                    disabled={loading}
                                    style={{
                                        padding: '10px 20px',
                                        background: '#16a34a',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontWeight: '600',
                                        fontSize: '14px'
                                    }}
                                >
                                    {loading ? 'Setting...' : 'Save'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowRateInput(false);
                                        setNewRateValue('');
                                    }}
                                    style={{
                                        padding: '10px 20px',
                                        background: '#6b7280',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                        <p style={{ fontSize: '13px', color: '#dc2626', margin: 0 }}>
                            Exchange rate is required for currency conversion on {formData.paymentDate}. Enter: 1 USD = ? IQD
                        </p>
                    </div>
                ) : exchangeRate ? (
                    <div className="exchange-rate-info">
                        <i className="fas fa-check-circle"></i>
                        <strong>Exchange Rate for {formData.paymentDate}:</strong> 1 USD = {formatNumber(exchangeRate)} IQD
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className="invoice-form">
                    {/* Two Column Grid for Steps 1-2 */}
                    <div className="invoice-form-grid">
                        {/* STEP 1: Payment Currency */}
                        <div className="form-section">
                            <h4 className="section-title">
                                <span className="step-number">1</span>
                                Payment Currency
                            </h4>

                            <div className="form-group">
                                <label htmlFor="paymentCurrency">How is patient paying?</label>
                                <select
                                    id="paymentCurrency"
                                    name="paymentCurrency"
                                    value={formData.paymentCurrency}
                                    onChange={handleInputChange}
                                    className="currency-select"
                                >
                                    <option value="USD">US Dollars (USD) Only</option>
                                    <option value="IQD">Iraqi Dinar (IQD) Only</option>
                                    <option value="MIXED">Mixed (USD + IQD)</option>
                                </select>
                            </div>
                        </div>

                        {/* STEP 2: Amount to Register */}
                        <div className="form-section">
                        <h4 className="section-title">
                            <span className="step-number">2</span>
                            Amount to Register
                        </h4>

                        <div className="form-group">
                            <label htmlFor="amountToRegister">
                                Amount to Register ({calculations.accountCurrency}): <span style={{ color: '#dc2626' }}>*</span>
                            </label>
                            <input
                                id="amountToRegister"
                                type="text"
                                name="amountToRegister"
                                value={displayValues.amountToRegister}
                                onChange={(e) => handleMoneyInputChange('amountToRegister', e.target.value)}
                                onBlur={() => handleMoneyInputBlur('amountToRegister')}
                                onFocus={() => handleMoneyInputFocus('amountToRegister')}
                                required
                                placeholder={`Amount to deduct from balance`}
                                className="large-input"
                            />
                            <small style={{ color: '#6b7280' }}>
                                This amount will be registered to patient's account in {calculations.accountCurrency}
                            </small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="paymentDate">Payment Date: <span style={{ color: '#dc2626' }}>*</span></label>
                            <input
                                id="paymentDate"
                                type="date"
                                name="paymentDate"
                                value={formData.paymentDate}
                                onChange={handleInputChange}
                                required
                            />
                        </div>
                    </div>
                    </div>

                    {/* Two Column Grid for Steps 3-4 */}
                    <div className="invoice-form-grid">
                        {/* STEP 3: Cash Collection */}
                        <div className="form-section">
                        <h4 className="section-title">
                            <span className="step-number">3</span>
                            Cash Collection
                        </h4>

                        {formData.paymentCurrency !== 'MIXED' ? (
                            // Single Currency Payment
                            <>
                                {calculations.suggestedUSD > 0 && (
                                    <div className="suggestion-box">
                                        <i className="fas fa-lightbulb"></i>
                                        <span>Suggested: Collect {formatCurrency(calculations.suggestedUSD, 'USD')}</span>
                                    </div>
                                )}
                                {calculations.suggestedIQD > 0 && (
                                    <div className="suggestion-box">
                                        <i className="fas fa-lightbulb"></i>
                                        <span>Suggested: Collect {formatCurrency(calculations.suggestedIQD, 'IQD')}</span>
                                    </div>
                                )}

                                {formData.paymentCurrency === 'USD' && (
                                    <div className="form-group">
                                        <label htmlFor="actualUSD">
                                            USD Received: <span style={{ color: '#dc2626' }}>*</span>
                                        </label>
                                        <input
                                            id="actualUSD"
                                            type="text"
                                            name="actualUSD"
                                            value={displayValues.actualUSD}
                                            onChange={(e) => handleMoneyInputChange('actualUSD', e.target.value)}
                                            onBlur={() => handleMoneyInputBlur('actualUSD')}
                                            onFocus={() => handleMoneyInputFocus('actualUSD')}
                                            required
                                            placeholder="Enter USD amount"
                                            className="large-input"
                                        />
                                    </div>
                                )}

                                {formData.paymentCurrency === 'IQD' && (
                                    <div className="form-group">
                                        <label htmlFor="actualIQD">
                                            IQD Received: <span style={{ color: '#dc2626' }}>*</span>
                                        </label>
                                        <input
                                            id="actualIQD"
                                            type="text"
                                            name="actualIQD"
                                            value={displayValues.actualIQD}
                                            onChange={(e) => handleMoneyInputChange('actualIQD', e.target.value)}
                                            onBlur={() => handleMoneyInputBlur('actualIQD')}
                                            onFocus={() => handleMoneyInputFocus('actualIQD')}
                                            required
                                            placeholder="Enter IQD amount"
                                            className="large-input"
                                        />
                                    </div>
                                )}
                            </>
                        ) : (
                            // Mixed Payment
                            <div className="mixed-payment-section">
                                <div style={{
                                    background: '#eff6ff',
                                    padding: '12px',
                                    borderRadius: '6px',
                                    marginBottom: '16px',
                                    border: '1px solid #3b82f6'
                                }}>
                                    <strong>Target:</strong> {formatCurrency(formData.amountToRegister || 0, calculations.accountCurrency)}
                                    <br/>
                                    <small style={{ color: '#6b7280' }}>
                                        Ask patient: "How much USD and IQD do you have?"
                                    </small>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="actualUSD">USD Received:</label>
                                    <input
                                        id="actualUSD"
                                        type="text"
                                        value={displayValues.actualUSD}
                                        onChange={(e) => handleMixedUSDChange(e.target.value)}
                                        onBlur={() => handleMoneyInputBlur('actualUSD')}
                                        onFocus={() => handleMoneyInputFocus('actualUSD')}
                                        placeholder="Enter USD amount"
                                    />
                                    {formData.actualUSD && (
                                        <small style={{ color: '#10b981' }}>
                                            = {formatCurrency(
                                                calculations.accountCurrency === 'USD'
                                                    ? parseFloat(formData.actualUSD)
                                                    : parseFloat(formData.actualUSD) * exchangeRate,
                                                calculations.accountCurrency
                                            )} value
                                        </small>
                                    )}
                                    {calculations.suggestedIQD > 0 && !formData.actualIQD && (
                                        <small style={{ color: '#3b82f6' }}>
                                            💡 Still need: {formatCurrency(calculations.suggestedIQD, 'IQD')}
                                        </small>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label htmlFor="actualIQD">IQD Received:</label>
                                    <input
                                        id="actualIQD"
                                        type="text"
                                        value={displayValues.actualIQD}
                                        onChange={(e) => handleMixedIQDChange(e.target.value)}
                                        onBlur={() => handleMoneyInputBlur('actualIQD')}
                                        onFocus={() => handleMoneyInputFocus('actualIQD')}
                                        placeholder={calculations.suggestedIQD > 0 ? `Suggested: ${formatNumber(calculations.suggestedIQD)}` : "Enter IQD amount"}
                                    />
                                    {formData.actualIQD && (
                                        <small style={{ color: '#10b981' }}>
                                            = {formatCurrency(
                                                calculations.accountCurrency === 'IQD'
                                                    ? parseFloat(formData.actualIQD)
                                                    : parseFloat(formData.actualIQD) / exchangeRate,
                                                calculations.accountCurrency
                                            )} value
                                        </small>
                                    )}
                                    {calculations.suggestedUSD > 0 && !formData.actualUSD && (
                                        <small style={{ color: '#3b82f6' }}>
                                            💡 Still need: {formatCurrency(calculations.suggestedUSD, 'USD')}
                                        </small>
                                    )}
                                </div>

                                {/* Real-time Total Display */}
                                {(formData.actualUSD || formData.actualIQD) && (
                                    <div style={{
                                        background: calculations.isShort ? '#fef2f2' : calculations.isExact ? '#f0fdf4' : '#fff7ed',
                                        border: `2px solid ${calculations.isShort ? '#ef4444' : calculations.isExact ? '#10b981' : '#f59e0b'}`,
                                        borderRadius: '8px',
                                        padding: '12px',
                                        marginTop: '12px'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <i className={`fas ${calculations.isShort ? 'fa-exclamation-triangle' : calculations.isExact ? 'fa-check-circle' : 'fa-info-circle'}`}
                                               style={{ color: calculations.isShort ? '#ef4444' : calculations.isExact ? '#10b981' : '#f59e0b' }}></i>
                                            <strong>Total Received: {formatCurrency(calculations.totalReceived, calculations.accountCurrency)}</strong>
                                        </div>
                                        {calculations.isShort && (
                                            <div style={{ color: '#dc2626', fontSize: '14px' }}>
                                                ⚠️ Short by {formatCurrency((formData.amountToRegister || 0) - calculations.totalReceived, calculations.accountCurrency)}
                                            </div>
                                        )}
                                        {calculations.isExact && (
                                            <div style={{ color: '#10b981', fontSize: '14px' }}>
                                                ✅ Exact amount
                                            </div>
                                        )}
                                        {calculations.isOver && (
                                            <div style={{ color: '#f59e0b', fontSize: '14px' }}>
                                                ✅ Overpaid by {formatCurrency(calculations.totalReceived - (formData.amountToRegister || 0), calculations.accountCurrency)}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                        {/* STEP 4: Change */}
                        <div className="form-section">
                        <h4 className="section-title">
                            <span className="step-number">4</span>
                            Change to Give
                        </h4>

                        {(() => {
                            // Detect same-currency payment
                            const isSameCurrencyPayment =
                                (calculations.accountCurrency === 'USD' && formData.paymentCurrency === 'USD') ||
                                (calculations.accountCurrency === 'IQD' && formData.paymentCurrency === 'IQD');

                            if (isSameCurrencyPayment) {
                                // Same currency - Hide change field, show explanation
                                return (
                                    <div style={{
                                        padding: '16px',
                                        background: '#f3f4f6',
                                        borderRadius: '8px',
                                        border: '2px solid #9ca3af'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <i className="fas fa-info-circle" style={{ color: '#6b7280' }}></i>
                                            <strong style={{ color: '#374151' }}>No Change Tracking Needed</strong>
                                        </div>
                                        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                                            Patient is paying in <strong>{calculations.accountCurrency}</strong> and account is in <strong>{calculations.accountCurrency}</strong>.
                                            <br/>
                                            Any cash change given is standard cash handling and doesn't need to be registered in the system.
                                        </p>
                                        <input
                                            type="text"
                                            value="Not Applicable"
                                            disabled
                                            style={{
                                                width: '100%',
                                                padding: '10px',
                                                background: '#e5e7eb',
                                                border: '1px solid #d1d5db',
                                                borderRadius: '6px',
                                                color: '#9ca3af',
                                                cursor: 'not-allowed',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                textAlign: 'center'
                                            }}
                                        />
                                    </div>
                                );
                            } else {
                                // Cross-currency or mixed - Show normal change field
                                return (
                                    <div className="form-group">
                                        <label htmlFor="change">
                                            Change Given (IQD):
                                        </label>
                                        <input
                                            id="change"
                                            type="text"
                                            name="change"
                                            value={displayValues.change}
                                            onChange={(e) => handleChangeOverride(e.target.value)}
                                            onBlur={() => handleMoneyInputBlur('change')}
                                            onFocus={() => handleMoneyInputFocus('change')}
                                            placeholder="0"
                                        />
                                        <small style={{ color: '#6b7280', display: 'block', marginTop: '4px' }}>
                                            Track IQD change given back during currency conversion
                                        </small>
                                        {calculations.calculatedChange > 0 && !formData.changeManualOverride && (
                                            <small style={{ color: '#10b981' }}>
                                                ✓ Auto-calculated based on overpayment
                                            </small>
                                        )}
                                        {formData.changeManualOverride && (
                                            <small style={{ color: '#f59e0b' }}>
                                                ✏️ Manually overridden
                                            </small>
                                        )}
                                    </div>
                                );
                            }
                        })()}
                    </div>
                    </div>

                    {/* Final Summary - Full Width */}
                    {(formData.actualUSD || formData.actualIQD) && (
                        <div style={{
                            background: '#f9fafb',
                            border: '2px solid #e5e7eb',
                            borderRadius: '8px',
                            padding: '16px',
                            margin: '0 24px 24px'
                        }}>
                            <h4 style={{ margin: '0 0 12px 0', color: '#374151' }}>✅ Payment Summary</h4>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                                <div>
                                    <strong>Cash IN:</strong>
                                    <br/>
                                    USD: {formatCurrency(formData.actualUSD || 0, 'USD')}
                                    <br/>
                                    IQD: {formatCurrency(formData.actualIQD || 0, 'IQD')}
                                </div>
                                <div>
                                    <strong>Cash OUT:</strong>
                                    <br/>
                                    Change: {formatCurrency(formData.change || 0, 'IQD')}
                                </div>
                            </div>

                            <div style={{
                                marginTop: '12px',
                                paddingTop: '12px',
                                borderTop: '1px solid #e5e7eb',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                color: '#111827'
                            }}>
                                Registered to Account: {formatCurrency(formData.amountToRegister || 0, calculations.accountCurrency)}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="form-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary btn-lg"
                            disabled={loading || !exchangeRate}
                        >
                            {loading ? (
                                <>
                                    <i className="fas fa-spinner fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-save"></i>
                                    Save Payment
                                </>
                            )}
                        </button>
                    </div>
                </form>
                    </>
                ) : (
                    /* Payment Success State with Print Button */
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                        <div style={{ fontSize: '64px', color: '#16a34a', marginBottom: '20px' }}>
                            <i className="fas fa-check-circle"></i>
                        </div>
                        <h2 style={{ margin: '0 0 10px 0', fontSize: '24px', color: '#111827' }}>
                            Payment Recorded Successfully!
                        </h2>
                        <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '30px' }}>
                            Amount: <strong style={{ color: '#16a34a', fontSize: '20px' }}>
                                {formatCurrency(receiptData?.amountPaidToday || 0, receiptData?.Currency || 'IQD')}
                            </strong>
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                onClick={handlePrint}
                                className="btn btn-primary btn-lg"
                            >
                                <i className="fas fa-print"></i>
                                Print Receipt
                            </button>
                            <button
                                onClick={handleCloseAfterSuccess}
                                className="btn btn-secondary"
                            >
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

export default PaymentModal;
