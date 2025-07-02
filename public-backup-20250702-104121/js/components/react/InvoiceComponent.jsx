import React, { useState, useEffect } from 'react'

const InvoiceComponent = ({ patientId }) => {
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showRateModal, setShowRateModal] = useState(false);
    const [newExchangeRate, setNewExchangeRate] = useState('');
    const [workData, setWorkData] = useState(null);
    const [exchangeRate, setExchangeRate] = useState(1500);
    const [formData, setFormData] = useState({
        paymentDate: new Date().toISOString().substring(0, 10),
        paymentCurrency: 'IQD', // Currency patient is paying in
        amountPaid: '',
        actualAmount: '', // Amount in patient's payment currency
        change: 0
    });
    const [calculations, setCalculations] = useState({
        totalRequired: 0,
        accountCurrency: 'IQD',
        totalPaid: 0,
        remainingBalance: 0,
        convertedAmount: 0
    });

    useEffect(() => {
        if (showModal) {
            loadInvoiceData();
        }
    }, [showModal, patientId]);

    useEffect(() => {
        if (workData && exchangeRate && formData.actualAmount) {
            calculateAmounts();
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
                
                // Set up calculations
                setCalculations(prev => ({
                    ...prev,
                    totalRequired: work.TotalRequired || 0,
                    accountCurrency: work.Currency || 'IQD',
                    totalPaid: work.TotalPaid || 0,
                    remainingBalance: (work.TotalRequired || 0) - (work.TotalPaid || 0)
                }));
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

    const calculateAmounts = () => {
        const actualAmount = parseFloat(formData.actualAmount) || 0;
        const accountCurrency = calculations.accountCurrency;
        const paymentCurrency = formData.paymentCurrency;
        
        let convertedAmount = actualAmount;
        
        // Convert payment currency to account currency if different
        if (accountCurrency !== paymentCurrency) {
            if (accountCurrency === 'USD' && paymentCurrency === 'IQD') {
                // Converting IQD to USD
                convertedAmount = actualAmount / exchangeRate;
            } else if (accountCurrency === 'IQD' && paymentCurrency === 'USD') {
                // Converting USD to IQD
                convertedAmount = actualAmount * exchangeRate;
            }
        }

        setCalculations(prev => ({
            ...prev,
            convertedAmount: Math.round(convertedAmount)
        }));

        // Update form data with converted amount
        setFormData(prev => ({
            ...prev,
            amountPaid: Math.round(convertedAmount).toString()
        }));
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!workData || !formData.actualAmount) {
            alert('Please fill in all required fields');
            return;
        }

        try {
            setLoading(true);

            const invoiceData = {
                workid: workData.workid,
                amountPaid: parseInt(formData.amountPaid),
                paymentDate: formData.paymentDate,
                actualAmount: parseInt(formData.actualAmount),
                actualCurrency: formData.paymentCurrency,
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
                // Trigger refresh of payments if PaymentsComponent is present
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
            paymentCurrency: 'IQD',
            amountPaid: '',
            actualAmount: '',
            change: 0
        });
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
        return `${amount.toLocaleString()} ${currency}`;
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
                    <div className="modal-content large">
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
                                        <span>{workData.PatientName}</span>
                                    </div>
                                    <div className="summary-item">
                                        <label>Total Required:</label>
                                        <span>{formatCurrency(calculations.totalRequired, calculations.accountCurrency)}</span>
                                    </div>
                                    <div className="summary-item">
                                        <label>Total Paid:</label>
                                        <span>{formatCurrency(calculations.totalPaid, calculations.accountCurrency)}</span>
                                    </div>
                                    <div className="summary-item balance">
                                        <label>Remaining Balance:</label>
                                        <span className={calculations.remainingBalance > 0 ? 'negative' : 'positive'}>
                                            {formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Exchange Rate Info */}
                        <div className="exchange-rate-info">
                            <i className="fas fa-info-circle"></i>
                            <strong>Current Exchange Rate:</strong> 1 USD = {exchangeRate} IQD
                        </div>

                        {loading ? (
                            <div className="loading-state">
                                <i className="fas fa-spinner fa-spin"></i>
                                Loading...
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="invoice-form">
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

                                <div className="form-group">
                                    <label htmlFor="paymentCurrency">Payment Currency:</label>
                                    <select
                                        id="paymentCurrency"
                                        name="paymentCurrency"
                                        value={formData.paymentCurrency}
                                        onChange={handleInputChange}
                                    >
                                        <option value="IQD">Iraqi Dinar (IQD)</option>
                                        <option value="USD">US Dollar (USD)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="actualAmount">
                                        Amount Paid ({formData.paymentCurrency}):
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
                                    />
                                </div>

                                {/* Currency conversion display */}
                                {formData.actualAmount && calculations.accountCurrency !== formData.paymentCurrency && (
                                    <div className="conversion-display">
                                        <i className="fas fa-calculator"></i>
                                        <strong>Conversion:</strong>
                                        <span>
                                            {formatCurrency(parseFloat(formData.actualAmount) || 0, formData.paymentCurrency)} = {formatCurrency(calculations.convertedAmount, calculations.accountCurrency)}
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
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="btn btn-primary btn-lg"
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            Adding Invoice...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-save"></i>
                                            Add Invoice
                                        </>
                                    )}
                                </button>
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
                                />
                            </div>

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
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InvoiceComponent;