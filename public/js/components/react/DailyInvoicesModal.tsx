import { useState, useEffect } from 'react';
import { formatCurrency as formatCurrencyUtil } from '../../utils/formatters';

interface Invoice {
    invoiceID: number;
    PatientName: string;
    SysStartTime: string;
    currency: 'IQD' | 'USD';
    Amountpaid: number;
    IQDReceived?: number;
    USDReceived?: number;
    Change?: number;
}

interface SelectedDateData {
    Day?: string;
    ExpensesIQD?: number;
    ExpensesUSD?: number;
    QasaIQD?: number;
    QasaUSD?: number;
}

interface Totals {
    totalIQD: number;
    totalUSD: number;
    totalChangeIQD: number;
    netIQD: number;
    netUSD: number;
}

interface DailyInvoicesModalProps {
    selectedDate: string | SelectedDateData | null;
    onClose: () => void;
}

const DailyInvoicesModal = ({ selectedDate, onClose }: DailyInvoicesModalProps) => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Extract the date from selectedDate (could be just date string or full day object)
    const dateValue = typeof selectedDate === 'object' && selectedDate?.Day
        ? selectedDate.Day
        : selectedDate as string;

    // Cast for accessing object properties
    const selectedDateObj = typeof selectedDate === 'object' ? selectedDate : null;

    useEffect(() => {
        if (dateValue) {
            fetchDailyInvoices();
        }
    }, [dateValue]);

    const fetchDailyInvoices = async (): Promise<void> => {
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
            setError(err instanceof Error ? err.message : 'Unknown error');
            console.error('Error fetching daily invoices:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount: number, currency: 'IQD' | 'USD'): string => {
        return formatCurrencyUtil(amount, currency);
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatTime = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Calculate totals
    const calculateTotals = (): Totals => {
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
            <div className="statistics-modal-container" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
                                    {selectedDateObj?.ExpensesIQD !== undefined && (
                                        <div className="summary-item">
                                            <span className="label">Expenses (IQD):</span>
                                            <span className="value negative">{formatCurrency(Math.abs(selectedDateObj.ExpensesIQD || 0), 'IQD')}</span>
                                        </div>
                                    )}
                                    {selectedDateObj?.ExpensesUSD !== undefined && (
                                        <div className="summary-item">
                                            <span className="label">Expenses (USD):</span>
                                            <span className="value negative">{formatCurrency(Math.abs(selectedDateObj.ExpensesUSD || 0), 'USD')}</span>
                                        </div>
                                    )}
                                    <div className="summary-item highlight">
                                        <span className="label">Net IQD (Qasa):</span>
                                        <span className="value">{formatCurrency(selectedDateObj?.QasaIQD || totals.netIQD, 'IQD')}</span>
                                    </div>
                                    <div className="summary-item highlight">
                                        <span className="label">Net USD (Qasa):</span>
                                        <span className="value">{formatCurrency(selectedDateObj?.QasaUSD || totals.netUSD, 'USD')}</span>
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
                                                <td data-label="Invoice #" className="invoice-id">{invoice.invoiceID}</td>
                                                <td data-label="Patient Name" className="patient-name text-rtl">
                                                    {invoice.PatientName}
                                                </td>
                                                <td data-label="Time" className="time">{formatTime(invoice.SysStartTime)}</td>
                                                <td data-label="Treatment Currency" className="currency-badge">
                                                    <span className={`badge ${invoice.currency}`}>
                                                        {invoice.currency}
                                                    </span>
                                                </td>
                                                <td data-label="Amount Paid" className="amount">
                                                    {invoice.Amountpaid} {invoice.currency}
                                                </td>
                                                <td data-label="IQD Received" className="amount iqd">
                                                    {invoice.IQDReceived ? formatCurrency(invoice.IQDReceived, 'IQD') : '-'}
                                                </td>
                                                <td data-label="USD Received" className="amount usd">
                                                    {invoice.USDReceived ? formatCurrency(invoice.USDReceived, 'USD') : '-'}
                                                </td>
                                                <td data-label="Change Given" className="amount change">
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
