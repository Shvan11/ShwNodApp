import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { doctorPaymentsQuery } from '@/query/queries';
import { httpErrorMessage } from '@/core/http';
import { formatNumber } from '../../utils/formatters';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import styles from './DoctorPaymentsModal.module.css';

export interface DoctorPaymentsTarget {
    doctorId: number;
    doctorName: string;
    /** Money collected in the period, straight off the aggregate row that was clicked. */
    paidIqd: number;
    paidUsd: number;
    /** Distinct paying works — only the Breakdown tab knows this; Commissions omits it. */
    workCount?: number;
}

interface DoctorPaymentsModalProps {
    target: DoctorPaymentsTarget;
    startDate: string;
    endDate: string;
    onClose: () => void;
}

/**
 * The per-payment detail behind one doctor's figure on Statistics → Breakdown
 * ("Revenue by Doctor") or Statistics → Commissions. Lists every invoice on that
 * doctor's works in the same period the tab has selected, with patient, work type,
 * date and amount.
 *
 * The headline totals come from the aggregate row that was CLICKED (`target`), never
 * from summing the listed rows. Two reasons they can differ: a very long period is
 * truncated server-side, and `works.currency` is nullable while the aggregates bucket
 * with `FILTER (WHERE currency = 'IQD'|'USD')` — so a NULL-currency work counts toward
 * neither total. Those payments are still listed (the money is real) with an em-dash
 * currency pill, while the headline stays the figure the user clicked on.
 */
const DoctorPaymentsModal = ({ target, startDate, endDate, onClose }: DoctorPaymentsModalProps) => {
    const navigate = useNavigate();

    const { data, isPending, isError, error } = useQuery(
        doctorPaymentsQuery(target.doctorId, startDate, endDate)
    );

    const rows = data?.rows ?? [];
    const truncated = data?.truncated ?? false;

    // Leaves the Statistics page entirely, so close the modal on the way out.
    const goToPatient = (personId: number): void => {
        onClose();
        navigate(`/patient/${personId}/works`);
    };

    const currencyClass = (currency: string | null): string => {
        if (currency === 'USD') return styles.badgeUsd;
        if (currency === 'IQD') return styles.badgeIqd;
        return styles.badgeNone;
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            contentClassName={styles.modal}
            ariaLabelledBy="doctor-payments-modal-title"
        >
            <ModalHeader
                variant="info"
                titleId="doctor-payments-modal-title"
                icon={<i className="fas fa-file-invoice-dollar" />}
                title={target.doctorName}
                subtitle={`Payments collected ${startDate} → ${endDate}`}
                onClose={onClose}
            />

            <div className={styles.body}>
                <div className={styles.totals}>
                    <div className={styles.totalItem}>
                        <span className={styles.totalLabel}>Collected IQD</span>
                        <span className={styles.totalValue}>{formatNumber(target.paidIqd)}</span>
                    </div>
                    <div className={styles.totalItem}>
                        <span className={styles.totalLabel}>Collected USD</span>
                        <span className={styles.totalValue}>{formatNumber(target.paidUsd)}</span>
                    </div>
                    <div className={styles.totalItem}>
                        <span className={styles.totalLabel}>Payments</span>
                        <span className={`${styles.totalValue} ${styles.totalValueNeutral}`}>
                            {formatNumber(rows.length)}
                        </span>
                    </div>
                    {target.workCount !== undefined && (
                        <div className={styles.totalItem}>
                            <span className={styles.totalLabel}>Works</span>
                            <span className={`${styles.totalValue} ${styles.totalValueNeutral}`}>
                                {formatNumber(target.workCount)}
                            </span>
                        </div>
                    )}
                </div>

                {isPending ? (
                    <p className={styles.message}>Loading payments…</p>
                ) : isError ? (
                    <p className={styles.messageError}>
                        <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>{' '}
                        {httpErrorMessage(error, 'Failed to load payments')}
                    </p>
                ) : rows.length === 0 ? (
                    <p className={styles.message}>No payments collected in this period.</p>
                ) : (
                    <>
                        {truncated && (
                            <p className={styles.truncationNote}>
                                <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                                Showing the {formatNumber(rows.length)} most recent payments only —
                                narrow the date range to see the rest. The totals above cover the
                                whole period.
                            </p>
                        )}
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Patient</th>
                                        <th>Work Type</th>
                                        <th className={styles.num}>Amount</th>
                                        <th>Currency</th>
                                        <th className={styles.num}>Invoice #</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr key={r.invoice_id}>
                                            <td data-label="Date" className={styles.date}>
                                                {r.date_of_payment}
                                            </td>
                                            <td data-label="Patient">
                                                <button
                                                    type="button"
                                                    className={styles.patientLink}
                                                    onClick={() => goToPatient(r.person_id)}
                                                    title="Open this patient's works"
                                                >
                                                    {r.patient_name}
                                                </button>
                                            </td>
                                            <td data-label="Work Type">{r.work_type}</td>
                                            <td data-label="Amount" className={`${styles.num} ${styles.amount}`}>
                                                {formatNumber(r.amount_paid)}
                                            </td>
                                            <td data-label="Currency">
                                                <span className={`${styles.badge} ${currencyClass(r.currency)}`}>
                                                    {r.currency ?? '—'}
                                                </span>
                                            </td>
                                            <td data-label="Invoice #" className={`${styles.num} ${styles.invoiceId}`}>
                                                {r.invoice_id}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            <div className={styles.footer}>
                <button type="button" className={styles.closeButton} onClick={onClose}>
                    Close
                </button>
            </div>
        </Modal>
    );
};

export default DoctorPaymentsModal;
