import React, { useState, useEffect } from 'react'
import '../../../css/components/invoice-form.css'

const PaymentModal = ({ workData, onClose, onSuccess }) => {
    const [loading, setLoading] = useState(false);
    const [exchangeRate, setExchangeRate] = useState(null);
    const [exchangeRateError, setExchangeRateError] = useState(false);
    const [showRateInput, setShowRateInput] = useState(false);
    const [newRateValue, setNewRateValue] = useState('');

    // Form state
    const [formData, setFormData] = useState({
        paymentDate: new Date().toISOString().substring(0, 10),
        paymentCurrency: 'IQD', // 'USD', 'IQD', 'MIXED'
        amountToRegister: '', // Amount in account currency
        actualUSD: '',
        actualIQD: '',
        change: 0,
        changeManualOverride: false
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
        if (workData) {
            initializeFormData();
        }
    }, [workData]);

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
        const rate = parseFloat(newRateValue);
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
                // Account is IQD, paying in USD
                suggestedUSD = Math.round(amountToRegister / exchangeRate);
            }
        } else if (paymentCurrency === 'IQD') {
            if (accountCurrency === 'IQD') {
                suggestedIQD = amountToRegister;
            } else {
                // Account is USD, paying in IQD
                suggestedIQD = Math.round(amountToRegister * exchangeRate);
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

        // Convert total received to account currency
        let totalInAccountCurrency;
        if (accountCurrency === 'USD') {
            totalInAccountCurrency = actualUSD + (actualIQD / exchangeRate);
        } else {
            totalInAccountCurrency = (actualUSD * exchangeRate) + actualIQD;
        }

        // Calculate overpayment
        const overpayment = totalInAccountCurrency - amountToRegister;

        // Convert overpayment to IQD (change always in IQD)
        let changeInIQD = 0;
        if (overpayment > 0) {
            if (accountCurrency === 'USD') {
                changeInIQD = Math.round(overpayment * exchangeRate);
            } else {
                changeInIQD = Math.round(overpayment);
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
        const usd = parseFloat(value) || 0;
        setFormData(prev => ({ ...prev, actualUSD: value }));

        if (usd > 0 && !formData.actualIQD && exchangeRate) {
            // Calculate remaining IQD needed
            const amountToRegister = parseFloat(formData.amountToRegister) || 0;
            const accountCurrency = calculations.accountCurrency;

            let usdValueInAccount = accountCurrency === 'USD' ? usd : usd * exchangeRate;
            let remainingInAccount = amountToRegister - usdValueInAccount;

            if (remainingInAccount > 0) {
                let neededIQD = accountCurrency === 'USD'
                    ? Math.round(remainingInAccount * exchangeRate)
                    : Math.round(remainingInAccount);

                setCalculations(prev => ({
                    ...prev,
                    suggestedIQD: neededIQD
                }));
            }
        }
    };

    const handleMixedIQDChange = (value) => {
        const iqd = parseFloat(value) || 0;
        setFormData(prev => ({ ...prev, actualIQD: value }));

        if (iqd > 0 && !formData.actualUSD && exchangeRate) {
            // Calculate remaining USD needed
            const amountToRegister = parseFloat(formData.amountToRegister) || 0;
            const accountCurrency = calculations.accountCurrency;

            let iqdValueInAccount = accountCurrency === 'IQD' ? iqd : iqd / exchangeRate;
            let remainingInAccount = amountToRegister - iqdValueInAccount;

            if (remainingInAccount > 0) {
                let neededUSD = accountCurrency === 'IQD'
                    ? Math.round(remainingInAccount / exchangeRate)
                    : Math.round(remainingInAccount);

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

    const handleChangeOverride = (value) => {
        setFormData(prev => ({
            ...prev,
            change: value,
            changeManualOverride: true
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

        try {
            setLoading(true);

            const invoiceData = {
                workid: workData.workid,
                amountPaid: amountPaid,
                paymentDate: formData.paymentDate,
                usdReceived: actualUSD,
                iqdReceived: actualIQD,
                change: parseInt(formData.change) || 0
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
                if (onSuccess) {
                    onSuccess(result);
                }
                onClose();
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

    return (
        <div className="modal-overlay">
            <div className="modal-content invoice-modal">
                <button className="modal-close" onClick={onClose}>×</button>

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
                                    type="number"
                                    value={newRateValue}
                                    onChange={(e) => setNewRateValue(e.target.value)}
                                    placeholder="Enter rate (e.g., 1406)"
                                    min="1"
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
                                type="number"
                                name="amountToRegister"
                                value={formData.amountToRegister}
                                onChange={handleInputChange}
                                required
                                min="0"
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
                                            type="number"
                                            name="actualUSD"
                                            value={formData.actualUSD}
                                            onChange={handleInputChange}
                                            required
                                            min="0"
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
                                            type="number"
                                            name="actualIQD"
                                            value={formData.actualIQD}
                                            onChange={handleInputChange}
                                            required
                                            min="0"
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
                                        type="number"
                                        value={formData.actualUSD}
                                        onChange={(e) => handleMixedUSDChange(e.target.value)}
                                        min="0"
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
                                        type="number"
                                        value={formData.actualIQD}
                                        onChange={(e) => handleMixedIQDChange(e.target.value)}
                                        min="0"
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

                        <div className="form-group">
                            <label htmlFor="change">
                                Change Given (IQD):
                            </label>
                            <input
                                id="change"
                                type="number"
                                name="change"
                                value={formData.change}
                                onChange={(e) => handleChangeOverride(e.target.value)}
                                min="0"
                                placeholder="0"
                            />
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
                    </div>

                    {/* Final Summary */}
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
            </div>
        </div>
    );
};

export default PaymentModal;
