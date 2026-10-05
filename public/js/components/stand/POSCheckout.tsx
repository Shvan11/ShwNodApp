import { useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, parseMoneyInput } from '../../utils/formatters';
import { patientPhonesQuery } from '@/query/queries';
import PatientSearchCombobox from '../react/PatientSearchCombobox';
import styles from './POSCheckout.module.css';

export interface CheckoutDetails {
  amountPaid: number;
  paymentMethod: string;
  personId: number | null;
  customerNote: string | null;
}

interface POSCheckoutProps {
  total: number;
  onConfirm: (details: CheckoutDetails) => void;
  /** The cart is empty or a sale is being recorded. */
  disabled?: boolean;
  /** A sale is being recorded (the button says so). */
  busy?: boolean;
}

/**
 * POSCheckout Component
 *
 * Checkout panel showing total amount, amount paid input with live change
 * calculation, payment method selector, optional patient link, and confirm button.
 *
 * The till remounts it after every sale (a `key`), so the next customer starts
 * with no patient, note or payment method carried over from the last one — the
 * link used to stick and was sent with the next sale (FE-F19-4).
 */
export default function POSCheckout({ total, onConfirm, disabled = false, busy = false }: POSCheckoutProps) {
  const [amountPaidRaw, setAmountPaidRaw] = useState('');
  // "Edited" = the cashier typed an amount other than the total. Typing the total
  // itself (or a scan being backed out of the field) keeps it following the cart.
  const [amountPaidEdited, setAmountPaidEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [customerNote, setCustomerNote] = useState('');

  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{ id: number; name: string } | null>(null);
  // The app's patient picker over the shared phone book (as the Transfer dialog):
  // names, phones and IDs all match. The box sent `?q=`, which the server matches
  // against phone and ID only, so no name ever found anyone (FE-F19-3).
  const { data: patients = [] } = useQuery(patientPhonesQuery());
  const pickerMode = /^\s*\d/.test(patientQuery) ? 'phoneId' : 'name';

  const amountPaid = parseMoneyInput(amountPaidRaw);
  const change = amountPaid - total;
  const isUnderpaid = amountPaid < total;
  const canConfirm = !disabled && total > 0 && !isUnderpaid;

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

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Allow digits and commas only
    const value = e.target.value.replace(/[^0-9,]/g, '');
    setAmountPaidRaw(value);
    setAmountPaidEdited(parseMoneyInput(value) !== total);
  };

  const handleAmountBlur = () => {
    if (amountPaid > 0) setAmountPaidRaw(formatNumber(amountPaid));
  };

  const handlePatientQueryChange = (value: string) => {
    setPatientQuery(value);
    setSelectedPatient(null);
  };

  const handlePatientPick = (personId: number) => {
    const name = patients.find((p) => p.id === personId)?.name ?? `#${personId}`;
    setSelectedPatient({ id: personId, name });
    setPatientQuery(name);
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      amountPaid,
      paymentMethod,
      personId: selectedPatient?.id ?? null,
      customerNote: customerNote.trim() || null,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          <i className="fas fa-cash-register" aria-hidden="true" /> Checkout
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
        <div className={`${styles.changeSection} ${isUnderpaid ? styles.changeNegative : styles.changePositive}`}>
          <span className={styles.changeLabel}>{isUnderpaid ? 'Remaining' : 'Change'}</span>
          <span className={styles.changeAmount}>{formatNumber(Math.abs(change))} IQD</span>
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
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pos-patient-search">
          Link to Patient (optional)
        </label>
        <div className={styles.patientInputWrapper}>
          <PatientSearchCombobox
            id="pos-patient-search"
            value={patientQuery}
            onChange={handlePatientQueryChange}
            onJump={handlePatientPick}
            patients={patients}
            mode={pickerMode}
            rtl={pickerMode === 'name' && patientQuery.trim() !== ''}
            placeholder="Patient name, phone or ID..."
            hint="Pick a patient to link this sale"
          />
          {selectedPatient && (
            <button
              type="button"
              className={styles.clearPatientButton}
              onClick={() => handlePatientQueryChange('')}
              aria-label="Clear patient selection"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          )}
        </div>
        {selectedPatient && (
          <span className={styles.patientLinked}>
            <i className="fas fa-check-circle" aria-hidden="true" /> Linked: {selectedPatient.name} (#{selectedPatient.id})
          </span>
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
      <button type="button" className={styles.confirmButton} onClick={handleConfirm} disabled={!canConfirm}>
        <i className="fas fa-check" aria-hidden="true" /> {busy ? 'Recording sale…' : 'Confirm Sale'}
      </button>
    </div>
  );
}
