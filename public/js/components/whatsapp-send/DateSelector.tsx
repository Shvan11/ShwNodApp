/**
 * Date Selector Component
 * Dropdown for selecting appointment date with controls
 */

import { ChangeEvent, MouseEvent } from 'react';
import type { DateSendability } from '../../hooks/useDateManager';
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
  /** The count read failed — the banner says so in its error colours. */
  countFailed: boolean;
  resetConfirm: boolean;
  emailConfirm: boolean;
  /** A reset / email request is in flight: its button stays disabled until it answers. */
  resetting: boolean;
  emailing: boolean;
  sendability: DateSendability;
}

function getSendabilityWarning(sendability: DateSendability): string | null {
  if (sendability.isSendable) return null;

  const { daysFromToday } = sendability;
  if (daysFromToday <= 0) {
    return 'Messages can only be sent for tomorrow or the day after tomorrow. This date is in the past or today.';
  }
  return `Messages can only be sent 1-2 days ahead. This date is ${daysFromToday} days from today. Select a closer date or wait until it is 1-2 days away.`;
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
  countFailed,
  resetConfirm,
  emailConfirm,
  resetting,
  emailing,
  sendability,
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
            disabled={loading || resetting}
            aria-label={
              resetConfirm ? 'Click again to confirm reset' : 'Reset all messages for selected date'
            }
          >
            <span className={styles.btnIcon} aria-hidden="true">
              {resetConfirm ? '⚠️' : '🔄'}
            </span>
            <span>{resetting ? 'Resetting...' : resetConfirm ? 'Click to Confirm Reset' : 'Reset Messages'}</span>
          </button>
          <button
            id="sendEmailBtn"
            className={`btn ${emailConfirm ? 'btn-warning' : 'btn-success'}`}
            onClick={handleSendEmailClick}
            disabled={loading || emailing}
            aria-label={
              emailConfirm ? 'Click again to confirm sending email' : 'Email appointment list to staff'
            }
          >
            <span className={styles.btnIcon} aria-hidden="true">
              {emailConfirm ? '⚠️' : '📧'}
            </span>
            <span>{emailing ? 'Sending email...' : emailConfirm ? 'Click to Confirm Email' : 'Email to Staff'}</span>
          </button>
        </div>

        <div
          id="messageCount"
          className={`${styles.messageCountInfo} ${loading ? styles.loading : countFailed ? styles.error : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {loading && <span className={styles.loadingSpinner} aria-hidden="true"></span>}
          <span>{displayMessage || 'Loading message count...'}</span>
        </div>

        {!sendability.isSendable && (
          <div className={styles.dateWarningBanner} role="alert">
            <span className={styles.dateWarningIcon} aria-hidden="true">!</span>
            <span>{getSendabilityWarning(sendability)}</span>
          </div>
        )}
      </fieldset>
    </section>
  );
}
