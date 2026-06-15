import { useState, useEffect, ChangeEvent } from 'react';
import type { HistoryEntry } from '@/types/api.types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { updateExchangeRate as updateExchangeRateContract } from '@shared/contracts/payment.contract';
import { qk } from '@/query/keys';
import { currentExchangeRateQuery, exchangeRatesHistoryQuery } from '@/query/queries';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber, parseFormattedNumber } from '../../utils/formatters';
import styles from './ExchangeRatesSettings.module.css';
import { formatISODate } from '../../core/utils';

interface ExchangeRatesSettingsProps {
    onChangesUpdate: (hasChanges: boolean) => void;
}

const todayIso = (): string => formatISODate();

const daysAgoIso = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return formatISODate(d);
};

const ExchangeRatesSettings = ({ onChangesUpdate }: ExchangeRatesSettingsProps) => {
    const toast = useToast();
    const queryClient = useQueryClient();
    const today = todayIso();

    const [editing, setEditing] = useState(false);
    const [draftValue, setDraftValue] = useState('');
    const [saving, setSaving] = useState(false);

    const [fromDate, setFromDate] = useState<string>(daysAgoIso(90));
    const [toDate, setToDate] = useState<string>(today);

    // Today's rate (404 = "not set today", a normal empty state → no retry/toast)
    // and the rate history for the selected range, both on useQuery.
    const {
        data: todayData,
        isLoading: todayLoading,
        isError: todayIsError,
        error: todayError,
    } = useQuery(currentExchangeRateQuery());
    const todayRate = todayData?.exchangeRate ?? null;

    const {
        data: historyData,
        isLoading: historyLoading,
        isError: historyIsError,
        error: historyError,
    } = useQuery(exchangeRatesHistoryQuery(fromDate, toDate));
    const history = (historyData?.rates ?? []) as HistoryEntry[];

    // A genuine (non-404) failure to load today's rate is worth a toast; a 404 isn't.
    useEffect(() => {
        if (todayIsError && (todayError as HttpError | null)?.status !== 404) {
            toast.error("Failed to load today's exchange rate");
        }
    }, [todayIsError, todayError, toast]);

    useEffect(() => {
        if (historyIsError) {
            toast.error(httpErrorMessage(historyError, 'Failed to load exchange rate history'));
        }
    }, [historyIsError, historyError, toast]);

    useEffect(() => {
        onChangesUpdate(editing);
    }, [editing, onChangesUpdate]);

    const handleStartEdit = () => {
        setDraftValue(todayRate ? formatNumber(todayRate) : '');
        setEditing(true);
    };

    const handleCancelEdit = () => {
        setEditing(false);
        setDraftValue('');
    };

    const handleDraftChange = (e: ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const parsed = parseFormattedNumber(raw);
        setDraftValue(parsed ? formatNumber(parsed) : raw.replace(/[^0-9]/g, ''));
    };

    const handleSave = async () => {
        const rate = parseFormattedNumber(draftValue);
        if (!rate || rate <= 0) {
            toast.warning('Please enter a valid exchange rate');
            return;
        }
        try {
            setSaving(true);
            await postJSON('/api/updateExchangeRateForDate', { date: today, exchangeRate: Math.round(rate) }, {
                schema: updateExchangeRateContract.response,
            });
            toast.success("Today's exchange rate updated");
            setEditing(false);
            setDraftValue('');
            // qk.exchangeRates.all() is the prefix over today's rate + the history
            // range (and PaymentModal's rate reads), so one invalidation refreshes
            // every exchange-rate observer app-wide.
            queryClient.invalidateQueries({ queryKey: qk.exchangeRates.all() });
        } catch (error) {
            console.error('Error saving rate:', error);
            toast.error(httpErrorMessage(error, 'Failed to update exchange rate'));
        } finally {
            setSaving(false);
        }
    };

    const handleFromChange = (e: ChangeEvent<HTMLInputElement>) => {
        setFromDate(e.target.value);
    };

    const handleToChange = (e: ChangeEvent<HTMLInputElement>) => {
        setToDate(e.target.value);
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2><i className="fas fa-dollar-sign"></i> Exchange Rates</h2>
                <p>Manage today's USD → IQD exchange rate and review rate history.</p>
            </div>

            <div className={styles.card}>
                <h3>Today's Rate ({today})</h3>

                {todayLoading ? (
                    <div className={styles.loading}>
                        <i className="fas fa-spinner fa-spin"></i> Loading...
                    </div>
                ) : editing ? (
                    <div className={styles.editRow}>
                        <div className={styles.inputGroup}>
                            <label htmlFor="rate-input">1 USD = </label>
                            <input
                                id="rate-input"
                                type="text"
                                inputMode="numeric"
                                value={draftValue}
                                onChange={handleDraftChange}
                                disabled={saving}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                                autoFocus
                            />
                            <span className={styles.suffix}>IQD</span>
                        </div>
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : 'Save'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleCancelEdit}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className={styles.displayRow}>
                        {todayRate !== null ? (
                            <span className={styles.rateValue}>
                                1 USD = <strong>{formatNumber(todayRate)}</strong> IQD
                            </span>
                        ) : (
                            <span className={styles.notSet}>
                                <i className="fas fa-exclamation-triangle"></i> Not set for today
                            </span>
                        )}
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleStartEdit}
                        >
                            <i className="fas fa-edit"></i> {todayRate !== null ? 'Edit' : 'Set Rate'}
                        </button>
                    </div>
                )}
            </div>

            <div className={styles.card}>
                <h3>History (read-only)</h3>

                <div className={styles.filters}>
                    <div className={styles.inputGroup}>
                        <label htmlFor="from-date">From</label>
                        <input
                            id="from-date"
                            type="date"
                            value={fromDate}
                            max={toDate}
                            onChange={handleFromChange}
                        />
                    </div>
                    <div className={styles.inputGroup}>
                        <label htmlFor="to-date">To</label>
                        <input
                            id="to-date"
                            type="date"
                            value={toDate}
                            min={fromDate}
                            max={today}
                            onChange={handleToChange}
                        />
                    </div>
                </div>

                {historyLoading ? (
                    <div className={styles.loading}>
                        <i className="fas fa-spinner fa-spin"></i> Loading...
                    </div>
                ) : history.length === 0 ? (
                    <div className={styles.emptyState}>
                        <i className="fas fa-inbox fa-2x"></i>
                        <p>No rates recorded in this range</p>
                    </div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th className={styles.rateCol}>1 USD → IQD</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((entry) => (
                                <tr key={entry.date} className={entry.date === today ? styles.todayRow : undefined}>
                                    <td data-label="Date">{entry.date}{entry.date === today && <span className={styles.todayBadge}>today</span>}</td>
                                    <td data-label="Rate" className={styles.rateCol}>{formatNumber(entry.exchangeRate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default ExchangeRatesSettings;
