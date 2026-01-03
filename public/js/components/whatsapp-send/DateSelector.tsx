/**
 * Date Selector Component
 * Dropdown for selecting appointment date with controls
 */

import { ChangeEvent, MouseEvent } from 'react';
import styles from '../../routes/WhatsAppSend.module.css';

export interface DateOption {
  value: string;
  label: string;
}

interface DateSelectorProps {
  currentDate: string;
  dateOptions: DateOption[];
  onDateChange: (date: string) => void;
  displayMessage: string;
  onRefresh: () => Promise<void>;
  onReset: () => Promise<void>;
  onSendEmail: () => Promise<void>;
  loading: boolean;
  resetConfirm: boolean;
  emailConfirm: boolean;
}

export default function DateSelector({
  currentDate,
  dateOptions,
  onDateChange,
  displayMessage,
  onRefresh,
  onReset,
  onSendEmail,
  loading,
  resetConfirm,
  emailConfirm,
}: DateSelectorProps) {
  const handleRefreshClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (onRefresh) await onRefresh();
  };

  const handleResetClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (onReset) await onReset();
  };

  const handleSendEmailClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (onSendEmail) await onSendEmail();
  };

  const handleDateSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    onDateChange(e.target.value);
  };

  return (
    <section className={styles.controlsArea}>
      <fieldset className={styles.dateSelectionPanel}>
        <legend className={styles.srOnly}>Date and Message Controls</legend>
        <div className={styles.dateControls}>
          <label htmlFor="dateSelector">Select Date:</label>
          <select
            id="dateSelector"
            className={styles.dateDropdown}
            value={currentDate}
            onChange={handleDateSelect}
            aria-label="Select date for messaging"
            aria-describedby="messageCount"
          >
            {dateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            id="refreshDateBtn"
            className="btn btn-secondary"
            onClick={handleRefreshClick}
            disabled={loading}
            aria-label="Refresh message count for selected date"
          >
            <span className={styles.btnIcon} aria-hidden="true">
              🔄
            </span>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <button
            id="resetMessagingBtn"
            className={`btn ${resetConfirm ? 'btn-warning' : 'btn-danger'}`}
            onClick={handleResetClick}
            disabled={loading}
            aria-label={
              resetConfirm ? 'Click again to confirm reset' : 'Reset all messages for selected date'
            }
          >
            <span className={styles.btnIcon} aria-hidden="true">
              {resetConfirm ? '⚠️' : '🔄'}
            </span>
            <span>{resetConfirm ? 'Click to Confirm Reset' : 'Reset Messages'}</span>
          </button>
          <button
            id="sendEmailBtn"
            className={`btn ${emailConfirm ? 'btn-warning' : 'btn-success'}`}
            onClick={handleSendEmailClick}
            disabled={loading}
            aria-label={
              emailConfirm ? 'Click again to confirm sending email' : 'Email appointment list to staff'
            }
          >
            <span className={styles.btnIcon} aria-hidden="true">
              {emailConfirm ? '⚠️' : '📧'}
            </span>
            <span>{emailConfirm ? 'Click to Confirm Email' : 'Email to Staff'}</span>
          </button>
        </div>

        <div
          id="messageCount"
          className={styles.messageCountInfo}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {loading && <span className={styles.loadingSpinner} aria-hidden="true"></span>}
          <span>{displayMessage || 'Loading message count...'}</span>
        </div>
      </fieldset>
    </section>
  );
}
