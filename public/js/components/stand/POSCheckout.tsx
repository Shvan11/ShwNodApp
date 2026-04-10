import React, { useState, useCallback, useEffect, useRef } from 'react';
import { formatNumber, parseMoneyInput } from '../../utils/formatters';
import styles from './POSCheckout.module.css';

interface PatientSearchResult {
  PersonID: number;
  PatientName: string;
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
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [customerNote, setCustomerNote] = useState('');

  // Patient search
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);

  const patientContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountPaid = parseMoneyInput(amountPaidRaw);
  const change = amountPaid - total;
  const isUnderpaid = amountPaid < total;
  const canConfirm = !disabled && total > 0 && !isUnderpaid;

  // Close patient dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        patientContainerRef.current &&
        !patientContainerRef.current.contains(e.target as Node)
      ) {
        setShowPatientDropdown(false);
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

  const searchPatients = useCallback(async (query: string) => {
    if (query.length < 2) {
      setPatientResults([]);
      setShowPatientDropdown(false);
      return;
    }

    setPatientSearchLoading(true);
    try {
      const response = await fetch(
        `/api/patients/search?q=${encodeURIComponent(query)}`
      );
      if (!response.ok) throw new Error('Search failed');
      const data = (await response.json()) as PatientSearchResult[];
      setPatientResults(data);
      setShowPatientDropdown(data.length > 0);
    } catch {
      setPatientResults([]);
      setShowPatientDropdown(false);
    } finally {
      setPatientSearchLoading(false);
    }
  }, []);

  const handlePatientQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setPatientQuery(value);
      setSelectedPatient(null);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        searchPatients(value);
      }, 300);
    },
    [searchPatients]
  );

  const handlePatientSelect = useCallback((patient: PatientSearchResult) => {
    setSelectedPatient(patient);
    setPatientQuery(patient.PatientName);
    setShowPatientDropdown(false);
    setPatientResults([]);
  }, []);

  const handleClearPatient = useCallback(() => {
    setSelectedPatient(null);
    setPatientQuery('');
    setPatientResults([]);
    setShowPatientDropdown(false);
  }, []);

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Allow digits and commas only
      const value = e.target.value.replace(/[^0-9,]/g, '');
      setAmountPaidRaw(value);
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
      selectedPatient?.PersonID ?? null,
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
            <i className="fas fa-check-circle" /> Linked: {selectedPatient.PatientName} (#{selectedPatient.PersonID})
          </span>
        )}
        {showPatientDropdown && (
          <ul className={styles.patientDropdown}>
            {patientResults.map((p) => (
              <li
                key={p.PersonID}
                className={styles.patientDropdownItem}
                onClick={() => handlePatientSelect(p)}
              >
                <span>{p.PatientName}</span>
                <span className={styles.patientId}>#{p.PersonID}</span>
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
