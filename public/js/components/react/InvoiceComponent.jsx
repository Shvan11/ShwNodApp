import React, { useState, useEffect } from 'react'
import '../../../css/components/invoice-form.css'

const InvoiceComponent = ({ patientId }) => {
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showRateModal, setShowRateModal] = useState(false);
    const [newExchangeRate, setNewExchangeRate] = useState('');
    const [workData, setWorkData] = useState(null);
    const [exchangeRate, setExchangeRate] = useState(1406);
    const [useBalance, setUseBalance] = useState(true);
    const [formData, setFormData] = useState({
        paymentDate: new Date().toISOString().substring(0, 10),
        requiredPayment: '', // Amount to register in account currency
        paymentCurrency: 'IQD', // Currency patient is paying in
        actualAmount: '', // Actual amount received in payment currency
        change: 0
    });
    const [calculations, setCalculations] = useState({
        totalRequired: 0,
        accountCurrency: 'IQD',
        totalPaid: 0,
        remainingBalance: 0,
        suggestedPayment: 0, // Amount patient should pay in selected currency
        amountToRegister: 0 // Amount to register in account currency
    });

    useEffect(() => {
        if (showModal) {
            loadInvoiceData();
        }
    }, [showModal, patientId]);

    // Calculate suggested payment when required payment or currency changes
    useEffect(() => {
        if (workData && exchangeRate && formData.requiredPayment) {
            calculateSuggestedPayment();
        }
    }, [formData.requiredPayment, formData.paymentCurrency, exchangeRate, workData]);

    // Calculate amount to register when actual payment changes
    useEffect(() => {
        if (workData && exchangeRate && formData.actualAmount) {
            calculateAmountToRegister();
        }
    }, [formData.actualAmount, formData.paymentCurrency, exchangeRate, workData]);

    const loadInvoiceData = async () => {
        try {
            setLoading(true);

            // Load work data and exchange rate in parallel
            const [workResponse, rateResponse] = await Promise.all([
                fetch(`/api/getActiveWorkForInvoice?PID=${patientId}`),
                fetch('/api/getCurrentExchangeRate')
            ]);

            if (!workResponse.ok || !rateResponse.ok) {
                throw new Error('Failed to load invoice data');
            }

            const workResult = await workResponse.json();
            const rateResult = await rateResponse.json();

            if (workResult.status === 'success' && workResult.data.length > 0) {
                const work = workResult.data[0];
                setWorkData(work);

                const remainingBalance = (work.TotalRequired || 0) - (work.TotalPaid || 0);

                // Set up calculations
                setCalculations(prev => ({
                    ...prev,
                    totalRequired: work.TotalRequired || 0,
                    accountCurrency: work.Currency || 'IQD',
                    totalPaid: work.TotalPaid || 0,
                    remainingBalance: remainingBalance
                }));

                // Auto-set required payment to remaining balance
                setFormData(prev => ({
                    ...prev,
                    requiredPayment: remainingBalance.toString(),
                    paymentCurrency: work.Currency || 'IQD' // Default to account currency
                }));
                setUseBalance(true);
            } else {
                throw new Error('No active work found for this patient');
            }

            if (rateResult.status === 'success') {
                setExchangeRate(rateResult.exchangeRate);
            } else {
                throw new Error(rateResult.message || 'Failed to get today\'s exchange rate');
            }

        } catch (error) {
            console.error('Error loading invoice data:', error);
            alert('Error loading invoice data: ' + error.message);
            setShowModal(false);
        } finally {
            setLoading(false);
        }
    };

    const calculateSuggestedPayment = () => {
        const requiredPayment = parseFloat(formData.requiredPayment) || 0;
        const accountCurrency = calculations.accountCurrency;
        const paymentCurrency = formData.paymentCurrency;

        let suggestedPayment = requiredPayment;

        // Convert account currency to payment currency if different
        if (accountCurrency !== paymentCurrency) {
            if (accountCurrency === 'USD' && paymentCurrency === 'IQD') {
                // Account in USD, paying in IQD
                suggestedPayment = requiredPayment * exchangeRate;
            } else if (accountCurrency === 'IQD' && paymentCurrency === 'USD') {
                // Account in IQD, paying in USD
                suggestedPayment = requiredPayment / exchangeRate;
            }
        }

        setCalculations(prev => ({
            ...prev,
            suggestedPayment: Math.round(suggestedPayment)
        }));

        // Auto-fill actual amount with suggested payment
        if (!formData.actualAmount) {
            setFormData(prev => ({
                ...prev,
                actualAmount: Math.round(suggestedPayment).toString()
            }));
        }
    };

    const calculateAmountToRegister = () => {
        const actualAmount = parseFloat(formData.actualAmount) || 0;
        const accountCurrency = calculations.accountCurrency;
        const paymentCurrency = formData.paymentCurrency;

        let amountToRegister = actualAmount;

        // Convert payment currency to account currency if different
        if (accountCurrency !== paymentCurrency) {
            if (accountCurrency === 'USD' && paymentCurrency === 'IQD') {
                // Account in USD, receiving IQD
                amountToRegister = actualAmount / exchangeRate;
            } else if (accountCurrency === 'IQD' && paymentCurrency === 'USD') {
                // Account in IQD, receiving USD
                amountToRegister = actualAmount * exchangeRate;
            }
        }

        setCalculations(prev => ({
            ...prev,
            amountToRegister: Math.round(amountToRegister)
        }));
    };

    const handleUseBalanceToggle = (checked) => {
        setUseBalance(checked);
        if (checked) {
            setFormData(prev => ({
                ...prev,
                requiredPayment: calculations.remainingBalance.toString()
            }));
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));

        // If user manually changes required payment, uncheck "Use Balance"
        if (name === 'requiredPayment') {
            setUseBalance(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!workData || !formData.actualAmount || !formData.requiredPayment) {
            alert('Please fill in all required fields');
            return;
        }

        try {
            setLoading(true);

            const invoiceData = {
                workid: workData.workid,
                amountPaid: calculations.amountToRegister, // Amount in account currency
                paymentDate: formData.paymentDate,
                actualAmount: parseInt(formData.actualAmount), // Actual cash received
                actualCurrency: formData.paymentCurrency, // Currency received
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
                alert('Invoice added successfully!');
                setShowModal(false);
                // Refresh the page to show updated data
                window.location.reload();
            } else {
                alert('Error adding invoice: ' + result.message);
            }
        } catch (error) {
            console.error('Error adding invoice:', error);
            alert('Error adding invoice: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const openInvoiceModal = () => {
        setFormData({
            paymentDate: new Date().toISOString().substring(0, 10),
            requiredPayment: '',
            paymentCurrency: 'IQD',
            actualAmount: '',
            change: 0
        });
        setUseBalance(true);
        setShowModal(true);
    };

    const openRateModal = () => {
        setNewExchangeRate(exchangeRate ? exchangeRate.toString() : '');
        setShowRateModal(true);
    };

    const handleUpdateExchangeRate = async (e) => {
        e.preventDefault();

        const rate = parseFloat(newExchangeRate);
        if (!rate || rate <= 0) {
            alert('Please enter a valid exchange rate');
            return;
        }

        try {
            setLoading(true);

            const response = await fetch('/api/updateExchangeRate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ exchangeRate: Math.round(rate) })
            });

            const result = await response.json();

            if (result.status === 'success') {
                setExchangeRate(Math.round(rate));
                alert('Exchange rate updated successfully!');
                setShowRateModal(false);
            } else {
                alert('Error updating exchange rate: ' + result.message);
            }
        } catch (error) {
            console.error('Error updating exchange rate:', error);
            alert('Error updating exchange rate: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount, currency) => {
        if (isNaN(amount) || amount === null || amount === undefined) {
            return `0 ${currency}`;
        }
        return `${Math.round(amount).toLocaleString()} ${currency}`;
    };

    console.log('🎯 Invoice Component Rendering:', { patientId });

    return (
        <div className="invoice-component">
            <div className="invoice-actions">
                <button className="btn btn-primary" onClick={openInvoiceModal}>
                    <i className="fas fa-plus"></i>
                    Add Invoice
                </button>

                <button className="btn btn-success" onClick={openRateModal}>
                    <i className="fas fa-exchange-alt"></i>
                    Update Exchange Rate
                </button>
            </div>

            {/* Add Invoice Modal */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-content invoice-modal">
                        <button
                            className="modal-close"
                            onClick={() => setShowModal(false)}
                        >
                            ×
                        </button>

                        <h2 className="modal-title">Add Invoice</h2>

                        {/* Account Summary */}
                        {workData && (
                            <div className="account-summary">
                                <h4>Account Summary</h4>
                                <div className="summary-grid">
                                    <div className="summary-item">
                                        <label>Patient:</label>
                                        <span className="value">{workData.PatientName}</span>
                                    </div>
                                    <div className="summary-item">
                                        <label>Account Currency:</label>
                                        <span className="value currency-badge">{calculations.accountCurrency}</span>
                                    </div>
                                    <div className="summary-item">
                                        <label>Total Required:</label>
                                        <span className="value">{formatCurrency(calculations.totalRequired, calculations.accountCurrency)}</span>
                                    </div>
                                    <div className="summary-item">
                                        <label>Total Paid:</label>
                                        <span className="value">{formatCurrency(calculations.totalPaid, calculations.accountCurrency)}</span>
                                    </div>
                                    <div className="summary-item highlight">
                                        <label>Remaining Balance:</label>
                                        <span className={`value ${calculations.remainingBalance > 0 ? 'negative' : 'positive'}`}>
                                            {formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Exchange Rate Info */}
                        <div className="exchange-rate-info">
                            <i className="fas fa-info-circle"></i>
                            <strong>Today's Exchange Rate:</strong> 1 USD = {exchangeRate.toLocaleString()} IQD
                        </div>

                        {loading ? (
                            <div className="loading-state">
                                <i className="fas fa-spinner fa-spin"></i>
                                Loading...
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="invoice-form">
                                {/* STEP 1: Amount to Register */}
                                <div className="form-section">
                                    <h4 className="section-title">
                                        <span className="step-number">1</span>
                                        Amount to Register in Patient File
                                    </h4>

                                    <div className="form-group checkbox-group">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={useBalance}
                                                onChange={(e) => handleUseBalanceToggle(e.target.checked)}
                                            />
                                            <span>Use Remaining Balance ({formatCurrency(calculations.remainingBalance, calculations.accountCurrency)})</span>
                                        </label>
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="requiredPayment">
                                            Payment Amount ({calculations.accountCurrency}):
                                        </label>
                                        <input
                                            id="requiredPayment"
                                            type="number"
                                            name="requiredPayment"
                                            value={formData.requiredPayment}
                                            onChange={handleInputChange}
                                            required
                                            min="0"
                                            placeholder={`Enter amount in ${calculations.accountCurrency}`}
                                            className="large-input"
                                        />
                                    </div>
                                </div>

                                {/* STEP 2: Payment Currency & Suggestion */}
                                <div className="form-section">
                                    <h4 className="section-title">
                                        <span className="step-number">2</span>
                                        How Will Patient Pay?
                                    </h4>

                                    <div className="form-group">
                                        <label htmlFor="paymentCurrency">Payment Currency:</label>
                                        <select
                                            id="paymentCurrency"
                                            name="paymentCurrency"
                                            value={formData.paymentCurrency}
                                            onChange={handleInputChange}
                                            className="currency-select"
                                        >
                                            <option value="IQD">Iraqi Dinar (IQD)</option>
                                            <option value="USD">US Dollar (USD)</option>
                                        </select>
                                    </div>

                                    {/* Suggested Payment Display */}
                                    {formData.requiredPayment && (
                                        <div className="suggested-payment-box">
                                            <div className="suggestion-icon">
                                                <i className="fas fa-lightbulb"></i>
                                            </div>
                                            <div className="suggestion-content">
                                                <p className="suggestion-label">Patient Should Pay:</p>
                                                <p className="suggestion-amount">
                                                    {formatCurrency(calculations.suggestedPayment, formData.paymentCurrency)}
                                                </p>
                                                {calculations.accountCurrency !== formData.paymentCurrency && (
                                                    <p className="conversion-detail">
                                                        ({formatCurrency(parseFloat(formData.requiredPayment), calculations.accountCurrency)}
                                                        {' '}× {exchangeRate.toLocaleString()} = {formatCurrency(calculations.suggestedPayment, formData.paymentCurrency)})
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* STEP 3: Actual Payment Received */}
                                <div className="form-section">
                                    <h4 className="section-title">
                                        <span className="step-number">3</span>
                                        Actual Payment Received
                                    </h4>

                                    <div className="form-group">
                                        <label htmlFor="actualAmount">
                                            Amount Received ({formData.paymentCurrency}):
                                        </label>
                                        <input
                                            id="actualAmount"
                                            type="number"
                                            name="actualAmount"
                                            value={formData.actualAmount}
                                            onChange={handleInputChange}
                                            required
                                            min="0"
                                            placeholder={`Enter amount in ${formData.paymentCurrency}`}
                                            className="large-input"
                                        />
                                    </div>

                                    {/* Show conversion if currencies differ */}
                                    {formData.actualAmount && calculations.accountCurrency !== formData.paymentCurrency && (
                                        <div className="conversion-info">
                                            <i className="fas fa-calculator"></i>
                                            <span>
                                                Will register: <strong>{formatCurrency(calculations.amountToRegister, calculations.accountCurrency)}</strong> to patient file
                                            </span>
                                        </div>
                                    )}

                                    <div className="form-group">
                                        <label htmlFor="change">
                                            Change Given ({formData.paymentCurrency}):
                                        </label>
                                        <input
                                            id="change"
                                            type="number"
                                            name="change"
                                            value={formData.change}
                                            onChange={handleInputChange}
                                            min="0"
                                            placeholder="0"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label htmlFor="paymentDate">Payment Date:</label>
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

                                {/* Submit Button */}
                                <div className="form-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setShowModal(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary btn-lg"
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
                                                Save Invoice
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Exchange Rate Update Modal */}
            {showRateModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <button
                            className="modal-close"
                            onClick={() => setShowRateModal(false)}
                        >
                            ×
                        </button>

                        <h2 className="modal-title">Update Exchange Rate</h2>

                        <p className="modal-description">
                            Set today's USD to IQD exchange rate ({new Date().toLocaleDateString()})
                        </p>

                        <form onSubmit={handleUpdateExchangeRate} className="rate-form">
                            <div className="form-group">
                                <label htmlFor="newExchangeRate">1 USD = ? IQD</label>
                                <input
                                    id="newExchangeRate"
                                    type="number"
                                    value={newExchangeRate}
                                    onChange={(e) => setNewExchangeRate(e.target.value)}
                                    required
                                    min="1"
                                    step="1"
                                    placeholder="Enter exchange rate (e.g., 1450)"
                                    className="large-input"
                                />
                            </div>

                            <div className="form-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowRateModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-success btn-lg"
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            Updating...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-check"></i>
                                            Update Rate
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InvoiceComponent;
