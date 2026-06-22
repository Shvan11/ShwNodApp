import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { doctorCommissionsQuery } from '@/query/queries';
import { httpErrorMessage } from '@/core/http';
import { formatNumber } from '../../utils/formatters';
import PeriodNavigator, { currentMonthStart, currentMonthEnd } from './PeriodNavigator';
import styles from './DoctorCommissionsView.module.css';

/**
 * Statistics → Commissions tab. For a From/To period (default: the current month),
 * lists each commission-enabled doctor with the money collected on their works and
 * the resulting commission, IQD and USD kept separate (one rate, no conversion).
 * Quit doctors are included for periods they were working. Self-contained: owns its
 * date-range state + query, so it does not depend on the page's monthly stats.
 */
const DoctorCommissionsView = () => {
    const [startDate, setStartDate] = useState(currentMonthStart);
    const [endDate, setEndDate] = useState(currentMonthEnd);

    const invalidRange = !!startDate && !!endDate && startDate > endDate;

    const { data, isFetching, isError, error } = useQuery({
        ...doctorCommissionsQuery(startDate, endDate),
        enabled: !invalidRange,
        placeholderData: keepPreviousData,
    });

    const rows = data?.rows ?? [];

    // Per-currency totals across all doctors.
    const totals = rows.reduce(
        (acc, r) => ({
            paidIqd: acc.paidIqd + r.paid_iqd,
            paidUsd: acc.paidUsd + r.paid_usd,
            commIqd: acc.commIqd + r.commission_iqd,
            commUsd: acc.commUsd + r.commission_usd,
        }),
        { paidIqd: 0, paidUsd: 0, commIqd: 0, commUsd: 0 }
    );

    return (
        <div className={styles.container}>
            <PeriodNavigator
                startDate={startDate}
                endDate={endDate}
                onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
                isFetching={isFetching && !invalidRange}
                idPrefix="commission"
            />

            {invalidRange ? (
                <p className={styles.message}>The start date must be on or before the end date.</p>
            ) : isError ? (
                <p className={styles.messageError}>
                    <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>{' '}
                    {httpErrorMessage(error, 'Failed to load commissions')}
                </p>
            ) : rows.length === 0 ? (
                <p className={styles.message}>
                    No commission-earning payments in this period. Only doctors with Percentage-Based
                    Compensation enabled appear here.
                </p>
            ) : (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Doctor</th>
                                <th className={styles.num}>Collected IQD</th>
                                <th className={styles.num}>Collected USD</th>
                                <th className={styles.num}>Rate</th>
                                <th className={styles.num}>Commission IQD</th>
                                <th className={styles.num}>Commission USD</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.doctor_id}>
                                    <td data-label="Doctor" className={styles.docName}>{r.doctor_name}</td>
                                    <td data-label="Collected IQD" className={styles.num}>{formatNumber(r.paid_iqd)}</td>
                                    <td data-label="Collected USD" className={styles.num}>{formatNumber(r.paid_usd)}</td>
                                    <td data-label="Rate" className={styles.num}>{r.commission_percentage}%</td>
                                    <td data-label="Commission IQD" className={`${styles.num} ${styles.commission}`}>{formatNumber(r.commission_iqd)}</td>
                                    <td data-label="Commission USD" className={`${styles.num} ${styles.commission}`}>{formatNumber(r.commission_usd)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className={styles.totalRow}>
                                <td data-label="Total"><strong>TOTAL</strong></td>
                                <td className={styles.num}><strong>{formatNumber(totals.paidIqd)}</strong></td>
                                <td className={styles.num}><strong>{formatNumber(totals.paidUsd)}</strong></td>
                                <td className={styles.num}></td>
                                <td className={`${styles.num} ${styles.commission}`}><strong>{formatNumber(totals.commIqd)}</strong></td>
                                <td className={`${styles.num} ${styles.commission}`}><strong>{formatNumber(totals.commUsd)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
};

export default DoctorCommissionsView;
