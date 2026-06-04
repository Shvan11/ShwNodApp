import { useState, useEffect } from 'react';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import { formatCurrency as formatCurrencyUtil } from '../../utils/formatters';
import Modal from './Modal';
import styles from './StatisticsComponent.module.css';

interface Invoice {
    invoice_id: number;
    patient_name: string;
    sys_start_time: string;
    currency: 'IQD' | 'USD';
    amount_paid: number;
    iqd_received?: number;
    usd_received?: number;
    change?: number;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateValue]);

    const fetchDailyInvoices = async (): Promise<void> => {
        setLoading(true);
        setError(null);

        try {
            const data = await fetchJSON<{ invoices?: Invoice[] }>(`/api/daily-invoices?date=${dateValue}`);
            setInvoices(data.invoices ?? []);
        } catch (err) {
            setError(httpErrorMessage(err, 'Failed to fetch daily invoices'));
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
            totalIQD += invoice.iqd_received || 0;
            totalUSD += invoice.usd_received || 0;
            totalChangeIQD += invoice.change || 0;
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
        <Modal
            isOpen
            onClose={onClose}
            overlayClassName={styles.statisticsModalOverlay}
            contentClassName={styles.statisticsModalContainer}
        >
                {/* Modal Header */}
                <div className={styles.statisticsModalHeader}>
                    <h2>
                        <i className="fas fa-file-invoice-dollar"></i>
                        Daily Invoices - {formatDate(dateValue)}
                    </h2>
                    <button className={styles.statisticsModalClose} onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Modal Content */}
                <div className={styles.statisticsModalBody}>
                    {loading && (
                        <div className={styles.loadingState}>
                            <div className={styles.spinner}></div>
                            <p>Loading invoices...</p>
                        </div>
                    )}

                    {error && (
                        <div className={styles.errorState}>
                            <i className="fas fa-exclamation-triangle"></i>
                            <p>{error}</p>
                            <button onClick={fetchDailyInvoices}>Retry</button>
                        </div>
                    )}

                    {!loading && !error && invoices.length === 0 && (
                        <div className={styles.emptyState}>
                            <i className="fas fa-inbox"></i>
                            <p>No invoices found for this date</p>
                        </div>
                    )}

                    {!loading && !error && invoices.length > 0 && (
                        <>
                            {/* Summary Cards */}
                            {totals && (
                                <div className={styles.statisticsInvoiceSummary}>
                                    <div className={styles.summaryItem}>
                                        <span className={styles.label}>Total IQD Received:</span>
                                        <span className={styles.value}>{formatCurrency(totals.totalIQD, 'IQD')}</span>
                                    </div>
                                    <div className={styles.summaryItem}>
                                        <span className={styles.label}>Total USD Received:</span>
                                        <span className={styles.value}>{formatCurrency(totals.totalUSD, 'USD')}</span>
                                    </div>
                                    <div className={styles.summaryItem}>
                                        <span className={styles.label}>Change Given (IQD):</span>
                                        <span className={`${styles.value} ${styles.negative}`}>{formatCurrency(totals.totalChangeIQD, 'IQD')}</span>
                                    </div>
                                    {selectedDateObj?.ExpensesIQD !== undefined && (
                                        <div className={styles.summaryItem}>
                                            <span className={styles.label}>Expenses (IQD):</span>
                                            <span className={`${styles.value} ${styles.negative}`}>{formatCurrency(Math.abs(selectedDateObj.ExpensesIQD || 0), 'IQD')}</span>
                                        </div>
                                    )}
                                    {selectedDateObj?.ExpensesUSD !== undefined && (
                                        <div className={styles.summaryItem}>
                                            <span className={styles.label}>Expenses (USD):</span>
                                            <span className={`${styles.value} ${styles.negative}`}>{formatCurrency(Math.abs(selectedDateObj.ExpensesUSD || 0), 'USD')}</span>
                                        </div>
                                    )}
                                    <div className={`${styles.summaryItem} ${styles.highlight}`}>
                                        <span className={styles.label}>Net IQD (Qasa):</span>
                                        <span className={styles.value}>{formatCurrency(selectedDateObj?.QasaIQD || totals.netIQD, 'IQD')}</span>
                                    </div>
                                    <div className={`${styles.summaryItem} ${styles.highlight}`}>
                                        <span className={styles.label}>Net USD (Qasa):</span>
                                        <span className={styles.value}>{formatCurrency(selectedDateObj?.QasaUSD || totals.netUSD, 'USD')}</span>
                                    </div>
                                </div>
                            )}

                            {/* Invoices Table */}
                            <div className={styles.statisticsTableWrapper}>
                                <table className={styles.statisticsInvoicesTable}>
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
                                            <tr key={invoice.invoice_id}>
                                                <td data-label="Invoice #" className={styles.invoiceId}>{invoice.invoice_id}</td>
                                                <td data-label="Patient Name" className={`${styles.patientName} text-rtl`}>
                                                    {invoice.patient_name}
                                                </td>
                                                <td data-label="Time">{formatTime(invoice.sys_start_time)}</td>
                                                <td data-label="Treatment Currency" className={styles.currencyBadge}>
                                                    <span className={`badge ${invoice.currency}`}>
                                                        {invoice.currency}
                                                    </span>
                                                </td>
                                                <td data-label="Amount Paid" className={styles.amount}>
                                                    {invoice.amount_paid} {invoice.currency}
                                                </td>
                                                <td data-label="IQD Received" className={`${styles.amount} ${styles.iqd}`}>
                                                    {invoice.iqd_received ? formatCurrency(invoice.iqd_received, 'IQD') : '-'}
                                                </td>
                                                <td data-label="USD Received" className={`${styles.amount} ${styles.usd}`}>
                                                    {invoice.usd_received ? formatCurrency(invoice.usd_received, 'USD') : '-'}
                                                </td>
                                                <td data-label="Change Given" className={`${styles.amount} ${styles.change}`}>
                                                    {invoice.change ? formatCurrency(invoice.change, 'IQD') : '-'}
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
                <div className={styles.statisticsModalFooter}>
                    <button className={styles.statisticsBtnClose} onClick={onClose}>
                        Close
                    </button>
                </div>
        </Modal>
    );
};

export default DailyInvoicesModal;
