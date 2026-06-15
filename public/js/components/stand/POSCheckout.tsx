import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, parseMoneyInput } from '../../utils/formatters';
import { patientSearchQuery } from '@/query/queries';
import styles from './POSCheckout.module.css';

interface PatientSearchResult {
  person_id: number;
  patient_name: string;
}

interface POSCheckoutProps {
  total: number;
  onConfirm: (
    amountPaid: number,
    paymentMethod: string,
    personId: number | null,
    customerNote: string | null
  ) => void;
  disabled?: boolean;
}

/**
 * POSCheckout Component
 *
 * Checkout panel showing total amount, amount paid input with live change
 * calculation, payment method selector, optional patient link, and confirm button.
 */
const POSCheckout: React.FC<POSCheckoutProps> = ({
  total,
  onConfirm,
  disabled = false,
}) => {
  const [amountPaidRaw, setAmountPaidRaw] = useState('');
  const [amountPaidEdited, setAmountPaidEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [customerNote, setCustomerNote] = useState('');

  // Patient search
  const [patientQuery, setPatientQuery] = useState('');
  const [debouncedPatientTerm, setDebouncedPatientTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  // The dropdown is dismissible (outside click / select / clear); track that
  // separately so a manual close doesn't reopen on every re-render.
  const [dismissed, setDismissed] = useState(false);

  const patientContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountPaid = parseMoneyInput(amountPaidRaw);
  const change = amountPaid - total;
  const isUnderpaid = amountPaid < total;
  const canConfirm = !disabled && total > 0 && !isUnderpaid;

  // React Query owns the fetch + out-of-order handling. Min-length gate (2)
  // lives in `enabled`; the factory already disables on an empty term.
  const patientSearchEnabled = debouncedPatientTerm.length >= 2;
  const { data: patientData, isFetching: patientSearchLoading, isSuccess: patientSearchSuccess } =
    useQuery({
      ...patientSearchQuery(debouncedPatientTerm),
      enabled: patientSearchEnabled,
    });

  // /api/patients/search returns { patients, totalCount, hasMore }; read .patients.
  const patientResults = (patientData?.patients ?? []) as PatientSearchResult[];
  const showPatientDropdown = !dismissed && patientSearchSuccess && patientResults.length > 0;

  // Close patient dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        patientContainerRef.current &&
        !patientContainerRef.current.contains(e.target as Node)
      ) {
        setDismissed(true);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Pre-fill Amount Paid with cart total; reset on cart clear; preserve user edits.
  // Adjust-during-render keyed on the cart total so a total change re-seeds the
  // field (unless the user has edited it) without a setState-in-effect bailout.
  const [seededForTotal, setSeededForTotal] = useState<number | null>(null);
  if (total !== seededForTotal) {
    setSeededForTotal(total);
    if (total === 0) {
      setAmountPaidRaw('');
      setAmountPaidEdited(false);
    } else if (!amountPaidEdited) {
      setAmountPaidRaw(formatNumber(total));
    }
  }

  const handlePatientQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setPatientQuery(value);
      setSelectedPatient(null);
      setDismissed(false);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        setDebouncedPatientTerm(value);
      }, 300);
    },
    []
  );

  const handlePatientSelect = useCallback((patient: PatientSearchResult) => {
    setSelectedPatient(patient);
    setPatientQuery(patient.patient_name);
    setDismissed(true);
  }, []);

  const handleClearPatient = useCallback(() => {
    setSelectedPatient(null);
    setPatientQuery('');
    setDebouncedPatientTerm('');
    setDismissed(true);
  }, []);

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow digits and commas only
      const value = e.target.value.replace(/[^0-9,]/g, '');
      setAmountPaidRaw(value);
      setAmountPaidEdited(true);
    },
    []
  );

  const handleAmountBlur = useCallback(() => {
    // Format on blur for display
    if (amountPaid > 0) {
      setAmountPaidRaw(formatNumber(amountPaid));
    }
  }, [amountPaid]);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(
      amountPaid,
      paymentMethod,
      selectedPatient?.person_id ?? null,
      customerNote.trim() || null
    );
  }, [canConfirm, amountPaid, paymentMethod, selectedPatient, customerNote, onConfirm]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-cash-register" /> Checkout
        </h3>
      </div>

      {/* Total amount */}
      <div className={styles.totalSection}>
        <span className={styles.totalLabel}>Total Amount</span>
        <span className={styles.totalAmount}>{formatNumber(total)} IQD</span>
      </div>

      {/* Amount paid */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pos-amount-paid">
          Amount Paid
        </label>
        <div className={styles.amountInputWrapper}>
          <input
            id="pos-amount-paid"
            type="text"
            className={styles.amountInput}
            value={amountPaidRaw}
            onChange={handleAmountChange}
            onBlur={handleAmountBlur}
            placeholder="0"
            disabled={disabled || total === 0}
            autoComplete="off"
            inputMode="numeric"
          />
          <span className={styles.currencyTag}>IQD</span>
        </div>
      </div>

      {/* Change display */}
      {total > 0 && amountPaid > 0 && (
        <div
          className={`${styles.changeSection} ${
            isUnderpaid ? styles.changeNegative : styles.changePositive
          }`}
        >
          <span className={styles.changeLabel}>
            {isUnderpaid ? 'Remaining' : 'Change'}
          </span>
          <span className={styles.changeAmount}>
            {formatNumber(Math.abs(change))} IQD
          </span>
        </div>
      )}

      {/* Payment method */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pos-payment-method">
          Payment Method
        </label>
        <select
          id="pos-payment-method"
          className={styles.select}
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          disabled={disabled}
        >
          <option value="cash">Cash</option>
          <option value="card">Card</option>
        </select>
      </div>

      {/* Patient link (optional) */}
      <div className={styles.field} ref={patientContainerRef}>
        <label className={styles.label} htmlFor="pos-patient-search">
          Link to Patient (optional)
        </label>
        <div className={styles.patientInputWrapper}>
          <input
            id="pos-patient-search"
            type="text"
            className={styles.patientInput}
            value={patientQuery}
            onChange={handlePatientQueryChange}
            placeholder="Search patient name..."
            disabled={disabled}
            autoComplete="off"
          />
          {patientSearchLoading && (
            <i className={`fas fa-spinner fa-spin ${styles.patientSpinner}`} />
          )}
          {selectedPatient && (
            <button
              type="button"
              className={styles.clearPatientButton}
              onClick={handleClearPatient}
              aria-label="Clear patient selection"
            >
              <i className="fas fa-times" />
            </button>
          )}
        </div>
        {selectedPatient && (
          <span className={styles.patientLinked}>
            <i className="fas fa-check-circle" /> Linked: {selectedPatient.patient_name} (#{selectedPatient.person_id})
          </span>
        )}
        {showPatientDropdown && (
          <ul className={styles.patientDropdown} role="listbox">
            {patientResults.map((p) => (
              <li
                key={p.person_id}
                className={styles.patientDropdownItem}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handlePatientSelect(p)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePatientSelect(p); } }}
              >
                <span>{p.patient_name}</span>
                <span className={styles.patientId}>#{p.person_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Customer note */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pos-customer-note">
          Note (optional)
        </label>
        <input
          id="pos-customer-note"
          type="text"
          className={styles.noteInput}
          value={customerNote}
          onChange={(e) => setCustomerNote(e.target.value)}
          placeholder="Add a note..."
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {/* Confirm button */}
      <button
        type="button"
        className={styles.confirmButton}
        onClick={handleConfirm}
        disabled={!canConfirm}
      >
        <i className="fas fa-check" /> Confirm Sale
      </button>
    </div>
  );
};

export default React.memo(POSCheckout);
