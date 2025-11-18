import React, { useState, useEffect } from 'react';
import { formatCurrency as formatCurrencyUtil } from '../../utils/formatters.js';

const DailyInvoicesModal = ({ selectedDate, onClose }) => {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Extract the date from selectedDate (could be just date string or full day object)
    const dateValue = selectedDate?.Day || selectedDate;

    useEffect(() => {
        if (dateValue) {
            fetchDailyInvoices();
        }
    }, [dateValue]);

    const fetchDailyInvoices = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/daily-invoices?date=${dateValue}`);
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch daily invoices');
            }

            setInvoices(data.invoices);
        } catch (err) {
            setError(err.message);
            console.error('Error fetching daily invoices:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount, currency) => {
        return formatCurrencyUtil(amount, currency);
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatTime = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Calculate totals
    const calculateTotals = () => {
        let totalIQD = 0;
        let totalUSD = 0;
        let totalChangeIQD = 0;

        invoices.forEach(invoice => {
            // Sum ALL IQD and USD received regardless of treatment currency
            totalIQD += invoice.IQDReceived || 0;
            totalUSD += invoice.USDReceived || 0;
            totalChangeIQD += invoice.Change || 0;
        });

        return {
            totalIQD,
            totalUSD,
            totalChangeIQD,
            netIQD: totalIQD - totalChangeIQD,
            netUSD: totalUSD
        };
    };

    const totals = invoices.length > 0 ? calculateTotals() : null;

    if (!selectedDate) return null;

    return (
        <div className="statistics-modal-overlay" onClick={onClose}>
            <div className="statistics-modal-container" onClick={(e) => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="statistics-modal-header">
                    <h2>
                        <i className="fas fa-file-invoice-dollar"></i>
                        Daily Invoices - {formatDate(dateValue)}
                    </h2>
                    <button className="statistics-modal-close" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Modal Content */}
                <div className="statistics-modal-body">
                    {loading && (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Loading invoices...</p>
                        </div>
                    )}

                    {error && (
                        <div className="error-state">
                            <i className="fas fa-exclamation-triangle"></i>
                            <p>{error}</p>
                            <button onClick={fetchDailyInvoices}>Retry</button>
                        </div>
                    )}

                    {!loading && !error && invoices.length === 0 && (
                        <div className="empty-state">
                            <i className="fas fa-inbox"></i>
                            <p>No invoices found for this date</p>
                        </div>
                    )}

                    {!loading && !error && invoices.length > 0 && (
                        <>
                            {/* Summary Cards */}
                            {totals && (
                                <div className="statistics-invoice-summary">
                                    <div className="summary-item">
                                        <span className="label">Total IQD Received:</span>
                                        <span className="value">{formatCurrency(totals.totalIQD, 'IQD')}</span>
                                    </div>
                                    <div className="summary-item">
                                        <span className="label">Total USD Received:</span>
                                        <span className="value">{formatCurrency(totals.totalUSD, 'USD')}</span>
                                    </div>
                                    <div className="summary-item">
                                        <span className="label">Change Given (IQD):</span>
                                        <span className="value negative">{formatCurrency(totals.totalChangeIQD, 'IQD')}</span>
                                    </div>
                                    {selectedDate?.ExpensesIQD !== undefined && (
                                        <div className="summary-item">
                                            <span className="label">Expenses (IQD):</span>
                                            <span className="value negative">{formatCurrency(Math.abs(selectedDate.ExpensesIQD || 0), 'IQD')}</span>
                                        </div>
                                    )}
                                    {selectedDate?.ExpensesUSD !== undefined && (
                                        <div className="summary-item">
                                            <span className="label">Expenses (USD):</span>
                                            <span className="value negative">{formatCurrency(Math.abs(selectedDate.ExpensesUSD || 0), 'USD')}</span>
                                        </div>
                                    )}
                                    <div className="summary-item highlight">
                                        <span className="label">Net IQD (Qasa):</span>
                                        <span className="value">{formatCurrency(selectedDate?.QasaIQD || totals.netIQD, 'IQD')}</span>
                                    </div>
                                    <div className="summary-item highlight">
                                        <span className="label">Net USD (Qasa):</span>
                                        <span className="value">{formatCurrency(selectedDate?.QasaUSD || totals.netUSD, 'USD')}</span>
                                    </div>
                                </div>
                            )}

                            {/* Invoices Table */}
                            <div className="statistics-table-wrapper">
                                <table className="statistics-invoices-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice #</th>
                                            <th>Patient Name</th>
                                            <th>Time</th>
                                            <th>Treatment Currency</th>
                                            <th>Amount Paid</th>
                                            <th>IQD Received</th>
                                            <th>USD Received</th>
                                            <th>Change (IQD)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.map((invoice) => (
                                            <tr key={invoice.invoiceID}>
                                                <td className="invoice-id">{invoice.invoiceID}</td>
                                                <td className="patient-name text-rtl">
                                                    {invoice.PatientName}
                                                </td>
                                                <td className="time">{formatTime(invoice.SysStartTime)}</td>
                                                <td className="currency-badge">
                                                    <span className={`badge ${invoice.currency}`}>
                                                        {invoice.currency}
                                                    </span>
                                                </td>
                                                <td className="amount">
                                                    {invoice.Amountpaid} {invoice.currency}
                                                </td>
                                                <td className="amount iqd">
                                                    {invoice.IQDReceived ? formatCurrency(invoice.IQDReceived, 'IQD') : '-'}
                                                </td>
                                                <td className="amount usd">
                                                    {invoice.USDReceived ? formatCurrency(invoice.USDReceived, 'USD') : '-'}
                                                </td>
                                                <td className="amount change">
                                                    {invoice.Change ? formatCurrency(invoice.Change, 'IQD') : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="statistics-modal-footer">
                    <button className="statistics-btn-close" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DailyInvoicesModal;
