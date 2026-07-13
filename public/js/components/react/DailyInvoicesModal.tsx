import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import { dailyInvoicesQuery } from '@/query/queries';
import { formatCurrency as formatCurrencyUtil } from '../../utils/formatters';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
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
    ExpectedCashIQD?: number;
    ExpectedCashUSD?: number;
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

/**
 * Normalize a day value to a YYYY-MM-DD string for the expenses date filter.
 * The statistics row's `Day` is already a date-only string; this guards against
 * an ISO-timestamp form as well.
 */
const toExpenseDate = (value: string): string => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
};

const DailyInvoicesModal = ({ selectedDate, onClose }: DailyInvoicesModalProps) => {
    const navigate = useNavigate();

    // Extract the date from selectedDate (could be just date string or full day object)
    const dateValue = typeof selectedDate === 'object' && selectedDate?.Day
        ? selectedDate.Day
        : selectedDate as string;

    // Cast for accessing object properties
    const selectedDateObj = typeof selectedDate === 'object' ? selectedDate : null;

    // Invoices for the chosen day (factory is gated on a truthy date).
    const { data, isLoading: loading, error: queryError, refetch } = useQuery(dailyInvoicesQuery(dateValue));
    const invoices = (data?.invoices ?? []) as Invoice[];
    const error = queryError ? httpErrorMessage(queryError, 'Failed to fetch daily invoices') : null;

    // Jump to the Expenses page pre-filtered to this day + currency.
    // We intentionally do NOT call onClose(): leaving ?day in the statistics URL is
    // what lets browser "back" from the expenses page re-open this modal.
    const goToExpenses = (currency: 'IQD' | 'USD'): void => {
        const day = toExpenseDate(dateValue);
        if (!day) return;
        navigate(`/expenses?startDate=${day}&endDate=${day}&currency=${currency}`);
    };

    const formatCurrency = (amount: number, currency: 'IQD' | 'USD'): string => {
        return formatCurrencyUtil(amount, currency);
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatTime = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleTimeString(undefined, {
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
            ariaLabelledBy="daily-invoices-modal-title"
        >
                <ModalHeader
                    variant="info"
                    titleId="daily-invoices-modal-title"
                    icon={<i className="fas fa-file-invoice-dollar" />}
                    title={`Daily Invoices - ${formatDate(dateValue)}`}
                    onClose={onClose}
                />

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
                            <button onClick={() => void refetch()}>Retry</button>
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
                                            <button
                                                type="button"
                                                className={`${styles.label} ${styles.labelLink}`}
                                                onClick={() => goToExpenses('IQD')}
                                                title="View IQD expenses for this day"
                                            >
                                                Expenses (IQD): <i className="fas fa-external-link-alt" aria-hidden="true"></i>
                                            </button>
                                            <span className={`${styles.value} ${styles.negative}`}>{formatCurrency(Math.abs(selectedDateObj.ExpensesIQD || 0), 'IQD')}</span>
                                        </div>
                                    )}
                                    {selectedDateObj?.ExpensesUSD !== undefined && (
                                        <div className={styles.summaryItem}>
                                            <button
                                                type="button"
                                                className={`${styles.label} ${styles.labelLink}`}
                                                onClick={() => goToExpenses('USD')}
                                                title="View USD expenses for this day"
                                            >
                                                Expenses (USD): <i className="fas fa-external-link-alt" aria-hidden="true"></i>
                                            </button>
                                            <span className={`${styles.value} ${styles.negative}`}>{formatCurrency(Math.abs(selectedDateObj.ExpensesUSD || 0), 'USD')}</span>
                                        </div>
                                    )}
                                    <div className={`${styles.summaryItem} ${styles.highlight}`}>
                                        <span className={styles.label}>Expected Cash (IQD):</span>
                                        <span className={styles.value}>{formatCurrency(selectedDateObj?.ExpectedCashIQD ?? totals.netIQD, 'IQD')}</span>
                                    </div>
                                    <div className={`${styles.summaryItem} ${styles.highlight}`}>
                                        <span className={styles.label}>Expected Cash (USD):</span>
                                        <span className={styles.value}>{formatCurrency(selectedDateObj?.ExpectedCashUSD ?? totals.netUSD, 'USD')}</span>
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
