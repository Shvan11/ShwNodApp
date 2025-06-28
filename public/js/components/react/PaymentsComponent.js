// PaymentsComponent.js - Payments component for patient portal
const PaymentsComponent = ({ patientId }) => {
    const { useState, useEffect } = React;
    
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    useEffect(() => {
        loadPayments();
    }, [patientId]);
    
    const loadPayments = async () => {
        try {
            setLoading(true);
            console.log('Loading payments for patient:', patientId);
            
            const response = await fetch(`/api/getpayments?code=${patientId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const paymentsData = await response.json();
            console.log('Payments received:', paymentsData);
            setPayments(paymentsData);
        } catch (err) {
            console.error('Error loading payments:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const calculateTotal = () => {
        return payments.reduce((sum, payment) => {
            const amount = payment.Payment || payment.payment || payment.amount || 0;
            return sum + (typeof amount === 'number' ? amount : 0);
        }, 0);
    };
    
    if (loading) {
        return React.createElement('div', { 
            className: 'loading-spinner' 
        }, 'Loading payments...');
    }
    
    if (error) {
        return React.createElement('div', { 
            className: 'error-message' 
        }, `Error: ${error}`);
    }
    
    if (!payments || payments.length === 0) {
        return React.createElement('div', {
            style: { padding: '20px', textAlign: 'center' }
        }, 'No payment records found for this patient.');
    }
    
    console.log('🎯 Payments Component Rendering:', { patientId, paymentsCount: payments.length });
    
    return React.createElement('div', { 
        style: { padding: '20px' }
    }, [
        React.createElement('h1', { 
            key: 'title',
            className: 'page-title',
        }, 'Payment History'),
        
        // Add Invoice Component
        React.createElement(window.InvoiceComponent, {
            key: 'invoice-component',
            patientId: patientId
        }),
        
        React.createElement('table', { key: 'table' }, [
            React.createElement('thead', { key: 'thead' },
                React.createElement('tr', { key: 'header-row' }, [
                    React.createElement('th', { key: 'no' }, 'No.'),
                    React.createElement('th', { key: 'date' }, 'Date'),
                    React.createElement('th', { key: 'amount' }, 'Amount')
                ])
            ),
            React.createElement('tbody', { key: 'tbody' }, [
                ...payments.map((payment, index) => 
                    React.createElement('tr', { key: index }, [
                        React.createElement('td', { key: 'no' }, index + 1),
                        React.createElement('td', { key: 'date' }, payment.Date || payment.date || 'N/A'),
                        React.createElement('td', { key: 'amount' }, 
                            typeof (payment.Payment || payment.payment || payment.amount || 0) === 'number' 
                                ? (payment.Payment || payment.payment || payment.amount || 0).toLocaleString('en-US')
                                : (payment.Payment || payment.payment || payment.amount || 0)
                        )
                    ])
                ),
                React.createElement('tr', { 
                    key: 'total-row',
                    className: 'total-row'
                }, [
                    React.createElement('td', { key: 'empty' }, ''),
                    React.createElement('td', { 
                        key: 'label',
                        style: { fontWeight: '700', textAlign: 'center' }
                    }, 'TOTAL'),
                    React.createElement('td', { 
                        key: 'total',
                        style: { fontSize: '20px', color: '#e74c3c' }
                    }, calculateTotal().toLocaleString('en-US'))
                ])
            ])
        ])
    ]);
};

window.PaymentsComponent = PaymentsComponent;