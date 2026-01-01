/**
 * Date Selector Component
 * Dropdown for selecting appointment date with controls
 */

import { ChangeEvent, MouseEvent } from 'react';

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
    <section className="controls-area">
      <fieldset className="date-selection-panel">
        <legend className="sr-only">Date and Message Controls</legend>
        <div className="date-controls">
          <label htmlFor="dateSelector">Select Date:</label>
          <select
            id="dateSelector"
            className="date-dropdown"
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
            <span className="btn-icon" aria-hidden="true">
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
            <span className="btn-icon" aria-hidden="true">
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
            <span className="btn-icon" aria-hidden="true">
              {emailConfirm ? '⚠️' : '📧'}
            </span>
            <span>{emailConfirm ? 'Click to Confirm Email' : 'Email to Staff'}</span>
          </button>
        </div>

        <div
          id="messageCount"
          className="message-count-info"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {loading && <span className="loading-spinner" aria-hidden="true"></span>}
          <span>{displayMessage || 'Loading message count...'}</span>
        </div>
      </fieldset>
    </section>
  );
}
