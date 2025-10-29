import React, { useState, useEffect } from 'react'
import InvoiceComponent from './InvoiceComponent.jsx'

const PaymentsComponent = ({ patientId }) => {
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

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };
    
    if (loading) {
        return (
            <div className="loading-spinner">
                Loading payments...
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="error-message">
                Error: {error}
            </div>
        );
    }
    
    if (!payments || payments.length === 0) {
        return (
            <div style={{ padding: '20px', textAlign: 'center' }}>
                No payment records found for this patient.
            </div>
        );
    }
    
    console.log('🎯 Payments Component Rendering:', { patientId, paymentsCount: payments.length });
    
    return (
        <div style={{ padding: '20px' }}>
            <h1 className="page-title">Payment History</h1>

            {/* Invoice Actions */}
            <InvoiceComponent patientId={patientId} />

            {/* Payment Summary */}
            <div className="payment-summary">
                <div className="summary-card">
                    <h3>Total Payments</h3>
                    <div className="total-amount">{formatCurrency(calculateTotal())}</div>
                </div>
                <div className="summary-card">
                    <h3>Number of Payments</h3>
                    <div className="payment-count">{payments.length}</div>
                </div>
            </div>
            
            {/* Payments Table */}
            <div className="payments-table-container">
                <table className="payments-table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Reference</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {payments.map((payment, index) => {
                            const amount = payment.Payment || payment.payment || payment.amount || 0;
                            const date = payment.Date || payment.date || payment.paymentDate;
                            const method = payment.Method || payment.method || payment.paymentMethod || 'Cash';
                            const reference = payment.Reference || payment.reference || payment.transactionId || '-';
                            const status = payment.Status || payment.status || 'Completed';
                            
                            return (
                                <tr key={payment.id || index} className="payment-row">
                                    <td className="payment-number">{index + 1}</td>
                                    <td className="payment-date">{formatDate(date)}</td>
                                    <td className="payment-amount">
                                        <span className="amount-value">
                                            {formatCurrency(amount)}
                                        </span>
                                    </td>
                                    <td className="payment-method">
                                        <span className={`method-badge method-${method.toLowerCase()}`}>
                                            {method}
                                        </span>
                                    </td>
                                    <td className="payment-reference">
                                        {reference}
                                    </td>
                                    <td className="payment-status">
                                        <span className={`status-badge status-${status.toLowerCase()}`}>
                                            {status}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="total-row">
                            <td colSpan="2"><strong>Total</strong></td>
                            <td className="total-amount">
                                <strong>{formatCurrency(calculateTotal())}</strong>
                            </td>
                            <td colSpan="3"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            
            {/* Payment Actions */}
            <div className="payment-actions">
                <button 
                    className="btn btn-primary"
                    onClick={() => window.print()}
                >
                    <i className="fas fa-print"></i>
                    Print Payment History
                </button>
                <button 
                    className="btn btn-secondary"
                    onClick={() => {
                        const csvData = payments.map(p => ({
                            Date: formatDate(p.Date || p.date),
                            Amount: p.Payment || p.payment || p.amount || 0,
                            Method: p.Method || p.method || 'Cash',
                            Reference: p.Reference || p.reference || '-'
                        }));
                        console.log('Export CSV:', csvData);
                    }}
                >
                    <i className="fas fa-download"></i>
                    Export to CSV
                </button>
            </div>
        </div>
    );
};

export default PaymentsComponent;