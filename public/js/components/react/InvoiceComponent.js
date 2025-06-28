// InvoiceComponent.js - Invoice management component with currency exchange
const InvoiceComponent = ({ patientId }) => {
    const { useState, useEffect } = React;
    
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

    return React.createElement('div', { 
        style: { padding: '20px' }
    }, [
        React.createElement('div', {
            key: 'button-group',
            style: { marginBottom: '20px', display: 'flex', gap: '10px' }
        }, [
            React.createElement('button', {
                key: 'add-invoice-btn',
                onClick: openInvoiceModal,
                style: { 
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                }
            }, 'Add Invoice'),
            
            React.createElement('button', {
                key: 'update-rate-btn',
                onClick: openRateModal,
                style: { 
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                }
            }, 'Update Exchange Rate')
        ]),

        // Modal
        showModal && React.createElement('div', {
            key: 'modal',
            style: {
                position: 'fixed',
                zIndex: 1000,
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }, React.createElement('div', { 
            style: {
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '8px',
                width: '90%',
                maxWidth: '600px',
                maxHeight: '90vh',
                overflow: 'auto',
                position: 'relative'
            }
        }, [
            React.createElement('span', {
                key: 'close',
                onClick: () => setShowModal(false),
                style: {
                    position: 'absolute',
                    right: '15px',
                    top: '15px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    color: '#aaa'
                }
            }, '×'),

            React.createElement('h2', { 
                key: 'title',
                style: { margin: '0 0 20px 0' }
            }, 'Add Invoice'),

            // Account Summary
            workData && React.createElement('div', {
                key: 'account-summary',
                style: {
                    backgroundColor: '#f8f9fa',
                    padding: '15px',
                    borderRadius: '5px',
                    marginBottom: '20px',
                    border: '1px solid #dee2e6'
                }
            }, [
                React.createElement('h4', { 
                    key: 'summary-title',
                    style: { margin: '0 0 10px 0' }
                }, 'Account Summary'),
                React.createElement('p', { key: 'patient' }, `Patient: ${workData.PatientName}`),
                React.createElement('p', { key: 'total' }, `Total Required: ${formatCurrency(calculations.totalRequired, calculations.accountCurrency)}`),
                React.createElement('p', { key: 'paid' }, `Total Paid: ${formatCurrency(calculations.totalPaid, calculations.accountCurrency)}`),
                React.createElement('p', { 
                    key: 'balance',
                    style: { fontWeight: 'bold', color: calculations.remainingBalance > 0 ? '#dc3545' : '#28a745' }
                }, `Remaining Balance: ${formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}`)
            ]),

            // Exchange Rate Info
            React.createElement('div', {
                key: 'exchange-info',
                style: {
                    backgroundColor: '#e7f3ff',
                    padding: '10px',
                    borderRadius: '5px',
                    marginBottom: '20px',
                    border: '1px solid #b3d9ff'
                }
            }, [
                React.createElement('strong', { key: 'rate-title' }, 'Current Exchange Rate: '),
                React.createElement('span', { key: 'rate' }, `1 USD = ${exchangeRate} IQD`)
            ]),

            loading ? React.createElement('div', { 
                key: 'loading',
                style: { textAlign: 'center', padding: '20px' }
            }, 'Loading...') : React.createElement('form', {
                key: 'form',
                onSubmit: handleSubmit,
                style: { display: 'flex', flexDirection: 'column', gap: '15px' }
            }, [
                React.createElement('div', { key: 'date-group' }, [
                    React.createElement('label', { 
                        key: 'date-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Payment Date:'),
                    React.createElement('input', {
                        key: 'date-input',
                        type: 'date',
                        name: 'paymentDate',
                        value: formData.paymentDate,
                        onChange: handleInputChange,
                        required: true,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    })
                ]),

                React.createElement('div', { key: 'currency-group' }, [
                    React.createElement('label', { 
                        key: 'currency-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Payment Currency:'),
                    React.createElement('select', {
                        key: 'currency-select',
                        name: 'paymentCurrency',
                        value: formData.paymentCurrency,
                        onChange: handleInputChange,
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    }, [
                        React.createElement('option', { key: 'iqd', value: 'IQD' }, 'Iraqi Dinar (IQD)'),
                        React.createElement('option', { key: 'usd', value: 'USD' }, 'US Dollar (USD)')
                    ])
                ]),

                React.createElement('div', { key: 'amount-group' }, [
                    React.createElement('label', { 
                        key: 'amount-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, `Amount Paid (${formData.paymentCurrency}):`),
                    React.createElement('input', {
                        key: 'amount-input',
                        type: 'number',
                        name: 'actualAmount',
                        value: formData.actualAmount,
                        onChange: handleInputChange,
                        required: true,
                        min: '0',
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    })
                ]),

                // Currency conversion display
                formData.actualAmount && calculations.accountCurrency !== formData.paymentCurrency && 
                React.createElement('div', {
                    key: 'conversion-display',
                    style: {
                        backgroundColor: '#fff3cd',
                        padding: '10px',
                        borderRadius: '5px',
                        border: '1px solid #ffeaa7'
                    }
                }, [
                    React.createElement('strong', { key: 'conversion-title' }, 'Conversion: '),
                    React.createElement('span', { key: 'conversion' }, 
                        `${formatCurrency(parseFloat(formData.actualAmount) || 0, formData.paymentCurrency)} = ${formatCurrency(calculations.convertedAmount, calculations.accountCurrency)}`
                    )
                ]),

                React.createElement('div', { key: 'change-group' }, [
                    React.createElement('label', { 
                        key: 'change-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, `Change Given (${formData.paymentCurrency}):`),
                    React.createElement('input', {
                        key: 'change-input',
                        type: 'number',
                        name: 'change',
                        value: formData.change,
                        onChange: handleInputChange,
                        min: '0',
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px'
                        }
                    })
                ]),

                React.createElement('button', {
                    key: 'submit',
                    type: 'submit',
                    disabled: loading,
                    style: {
                        backgroundColor: loading ? '#6c757d' : '#28a745',
                        color: 'white',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '16px',
                        marginTop: '10px'
                    }
                }, loading ? 'Adding Invoice...' : 'Add Invoice')
            ])
        ])),

        // Exchange Rate Update Modal
        showRateModal && React.createElement('div', {
            key: 'rate-modal',
            style: {
                position: 'fixed',
                zIndex: 1000,
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }, React.createElement('div', { 
            style: {
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '8px',
                width: '90%',
                maxWidth: '400px',
                position: 'relative'
            }
        }, [
            React.createElement('span', {
                key: 'close',
                onClick: () => setShowRateModal(false),
                style: {
                    position: 'absolute',
                    right: '15px',
                    top: '15px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    color: '#aaa'
                }
            }, '×'),

            React.createElement('h2', { 
                key: 'title',
                style: { margin: '0 0 20px 0' }
            }, 'Update Exchange Rate'),

            React.createElement('p', {
                key: 'description',
                style: { marginBottom: '20px', color: '#666' }
            }, `Set today's USD to IQD exchange rate (${new Date().toLocaleDateString()})`),

            React.createElement('form', {
                key: 'rate-form',
                onSubmit: handleUpdateExchangeRate,
                style: { display: 'flex', flexDirection: 'column', gap: '15px' }
            }, [
                React.createElement('div', { key: 'rate-group' }, [
                    React.createElement('label', { 
                        key: 'rate-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, '1 USD = ? IQD'),
                    React.createElement('input', {
                        key: 'rate-input',
                        type: 'number',
                        value: newExchangeRate,
                        onChange: (e) => setNewExchangeRate(e.target.value),
                        required: true,
                        min: '1',
                        step: '1',
                        placeholder: 'Enter exchange rate (e.g., 1450)',
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '16px'
                        }
                    })
                ]),

                React.createElement('button', {
                    key: 'submit',
                    type: 'submit',
                    disabled: loading,
                    style: {
                        backgroundColor: loading ? '#6c757d' : '#28a745',
                        color: 'white',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '4px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '16px'
                    }
                }, loading ? 'Updating...' : 'Update Rate')
            ])
        ]))
    ]);
};

window.InvoiceComponent = InvoiceComponent;