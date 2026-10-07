import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import { dailyInvoicesQuery } from '@/query/queries';
import { formatCurrency as formatCurrencyUtil, formatLocaleDate, formatLocaleTime } from '../../utils/formatters';
import { toLocalDateString } from '../../utils/calendarDate';
import type { EnrichedInvoiceRow } from '@shared/contracts/reports.contract';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './StatisticsComponent.module.css';

// The contract row — `currency` is nullable and `amount_paid` may arrive as a
// numeric string, so it is not narrowed with a cast (FE-F8-11).
type Invoice = EnrichedInvoiceRow;

/** The statistics row of the day (`reports.statistics` dailyData); null = that currency side had no row. */
interface SelectedDateData {
    Day?: string;
    ExpensesIQD?: number | null;
    ExpensesUSD?: number | null;
    ExpectedCashIQD?: number | null;
    ExpectedCashUSD?: number | null;
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
    return Number.isNaN(d.getTime()) ? '' : toLocalDateString(d);
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
    const invoices: Invoice[] = data?.invoices ?? [];
    const error = queryError ? httpErrorMessage(queryError, 'Failed to fetch daily invoices') : null;

    // Jump to the Expenses page pre-filtered to this day + currency.
    // We intentionally do NOT call onClose(): leaving ?day in the statistics URL is
    // what lets browser "back" from the expenses page re-open this modal.
    const goToExpenses = (currency: 'IQD' | 'USD'): void => {
        const day = toExpenseDate(dateValue);
        if (!day) return;
        navigate(`/expenses?startDate=${day}&endDate=${day}&currency=${currency}`);
    };

    const formatCurrency = (amount: number, currency: string): string => {
        return formatCurrencyUtil(amount, currency);
    };

    const formatDate = (dateString: string): string =>
        formatLocaleDate(dateString, { year: 'numeric', month: 'short', day: 'numeric' });

    const formatTime = (dateString: string | undefined): string =>
        formatLocaleTime(dateString, { hour: '2-digit', minute: '2-digit' }) || '-';

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

    // The day's figures (expenses, expected cash) come from the statistics row and
    // are shown even on a day with no payments: a day with expenses only used to
    // show just "No invoices found" (FE-F8-10). Opened from a bare date string there
    // is no row, and nothing to show but the invoices.
    const totals = invoices.length > 0 || selectedDateObj ? calculateTotals() : null;

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
                    icon={<i className="fas fa-file-invoice-dollar" aria-hidden="true" />}
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
                            <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                            <p>{error}</p>
                            <button onClick={() => void refetch()}>Retry</button>
                        </div>
                    )}

                    {!loading && !error && (invoices.length > 0 || totals) && (
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

                            {invoices.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <i className="fas fa-inbox" aria-hidden="true"></i>
                                    <p>No invoices found for this date</p>
                                </div>
                            ) : (
                            /* Invoices Table */
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
                                                    {/* styles.*, not the global string `badge ${currency}` — these
                                                        classes live in a CSS module, so the global names never
                                                        matched and the pill rendered completely unstyled. */}
                                                    <span className={`${styles.badge} ${invoice.currency === 'USD' ? styles.badgeUsd : styles.badgeIqd}`}>
                                                        {invoice.currency ?? '—'}
                                                    </span>
                                                </td>
                                                <td data-label="Amount Paid" className={styles.amount}>
                                                    {formatCurrency(Number(invoice.amount_paid ?? 0), invoice.currency ?? '')}
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
                            )}
                        </>
                    )}

                    {!loading && !error && invoices.length === 0 && !totals && (
                        <div className={styles.emptyState}>
                            <i className="fas fa-inbox" aria-hidden="true"></i>
                            <p>No invoices found for this date</p>
                        </div>
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
