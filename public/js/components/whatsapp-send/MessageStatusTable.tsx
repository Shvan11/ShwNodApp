/**
 * Message Status Table Component
 * Displays message status for selected date
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { StatusRow } from '@shared/contracts/messaging.contract';
import { MESSAGE_STATUS, MESSAGE_STATUS_TEXT, type MessageStatusValue } from '../../utils/whatsapp-send-constants';
import type { MessageSummary } from '../../hooks/useMessageStatus';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import styles from '../../routes/WhatsAppSend.module.css';
import { formatISODate } from '../../core/utils';
import { formatLocaleDate, formatLocaleTime } from '../../utils/formatters';

/**
 * WhatsApp-style delivery indicator for the Status column (Font Awesome):
 *  - 1 gray tick   (fa-check)         → sent to server
 *  - 2 gray ticks  (fa-check-double)  → delivered to device
 *  - 2 blue ticks  (fa-check-double)  → read / played
 *  - clock         (fa-clock)         → not sent yet / ready to resend
 *  - alert         (fa-circle-exclamation) → failed / invalid phone
 */
function StatusTicks({ status }: { status: number }) {
  switch (status) {
    case MESSAGE_STATUS.SERVER:
      return <i className={`fas fa-check ${styles.waTick} ${styles.waTickGray}`} aria-hidden="true" />;
    case MESSAGE_STATUS.DEVICE:
      return <i className={`fas fa-check-double ${styles.waTick} ${styles.waTickGray}`} aria-hidden="true" />;
    case MESSAGE_STATUS.READ:
    case MESSAGE_STATUS.PLAYED:
      return <i className={`fas fa-check-double ${styles.waTick} ${styles.waTickBlue}`} aria-hidden="true" />;
    case MESSAGE_STATUS.READY:
      return <i className={`fas fa-clock ${styles.waTick} ${styles.waTickReady}`} aria-hidden="true" />;
    case MESSAGE_STATUS.FAILED:
    case MESSAGE_STATUS.INVALID_PHONE:
      return <i className={`fas fa-circle-exclamation ${styles.waTick} ${styles.waTickFailed}`} aria-hidden="true" />;
    case MESSAGE_STATUS.PENDING:
    default:
      return <i className={`far fa-clock ${styles.waTick} ${styles.waTickPending}`} aria-hidden="true" />;
  }
}

interface MessageStatusTableProps {
  messages: StatusRow[];
  loading: boolean;
  currentDate: string;
  summary: MessageSummary;
  /**
   * Opens the row's resend/copy menu (owner: page). Fired by a right-click on the
   * row AND by the row's ⋮ button: right-click alone left the four actions with no
   * keyboard path and none at all on a tablet (FE-F25-6).
   */
  onRowContextMenu?: (event: ReactMouseEvent, msg: StatusRow) => void;
}

/** The selected day is a 'YYYY-MM-DD', read as a LOCAL day. */
function formatDisplayDate(date: string): string {
  return formatLocaleDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Ready-to-resend rows tint amber; failed / invalid-phone rows red. */
function rowClass(status: number): string | undefined {
  if (status === MESSAGE_STATUS.READY) return styles.rowReady;
  if (status === MESSAGE_STATUS.FAILED || status === MESSAGE_STATUS.INVALID_PHONE) return styles.rowFailed;
  return undefined;
}

export default function MessageStatusTable({
  messages,
  loading,
  currentDate,
  summary,
  onRowContextMenu,
}: MessageStatusTableProps) {
  if (loading) {
    return (
      <div className={styles.resultsPlaceholder}>
        <p className={styles.placeholderText}>
          <span className={styles.statusIcon} aria-hidden="true">
            ⏳
          </span>
          Loading message status...
        </p>
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    const todayStr = formatISODate();
    const isToday = currentDate === todayStr;
    const isPast = currentDate < todayStr;

    let message: string;
    if (isPast) {
      message = 'No messages were sent on this date';
    } else if (isToday) {
      message = 'No messages sent yet today';
    } else {
      message = 'No messages scheduled for this date';
    }

    return (
      <div className={styles.resultsPlaceholder}>
        <p className={styles.placeholderText}>
          <span className={styles.statusIcon} aria-hidden="true">
            📊
          </span>
          {message}
        </p>
      </div>
    );
  }

  const getTimeSent = (msg: StatusRow): string =>
    msg.timeSent ? formatLocaleTime(msg.timeSent) || 'Not sent' : 'Not sent';

  return (
    <div className={styles.messageStatusTable}>
      <h3>Message Status for {formatDisplayDate(currentDate)}</h3>
      <div className={styles.tableResponsive}>
        <table className={styles.statusTable}>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Time Sent</th>
              {onRowContextMenu && <th><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {messages.map((msg, index) => {
              const timeSent = getTimeSent(msg);
              const patientName = msg.patientName || msg.name || 'N/A';
              const phoneNumber = msg.phone ? formatPhoneForDisplay(msg.phone) : 'N/A';

              return (
                <tr
                  key={msg.appointmentId ?? `${msg.phone || 'na'}-${index}`}
                  className={rowClass(msg.status)}
                  onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, msg) : undefined}
                >
                  <td className={styles.patientName}>{patientName}</td>
                  <td className={styles.phoneNumber}>{phoneNumber}</td>
                  <td className={styles.statusCell}>
                    <span className={styles.waStatus}>
                      <StatusTicks status={msg.status} />
                      {MESSAGE_STATUS_TEXT[msg.status as MessageStatusValue] ?? 'Unknown'}
                    </span>
                    {msg.errorMessage && (
                      <div className={styles.errorReason} title={msg.errorMessage}>
                        {msg.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className={styles.timeSent}>{timeSent}</td>
                  {onRowContextMenu && (
                    <td className={styles.rowActionsCell}>
                      <button
                        type="button"
                        className={styles.rowActionsBtn}
                        aria-haspopup="menu"
                        aria-label={`Actions for ${patientName}`}
                        title="Re-send, open in WhatsApp, copy"
                        onClick={(e) => onRowContextMenu(e, msg)}
                      >
                        <i className="fas fa-ellipsis-v" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.tableSummary}>
        <span className={styles.summaryItem}>Total: {summary.total}</span>
        <span className={styles.summaryItem}>Not Sent: {summary.pending}</span>
        <span className={styles.summaryItem}>Ready: {summary.ready}</span>
        <span className={styles.summaryItem}>Server: {summary.server}</span>
        <span className={styles.summaryItem}>Device: {summary.device}</span>
        <span className={styles.summaryItem}>Read: {summary.read}</span>
        <span className={styles.summaryItem}>Played: {summary.played}</span>
        <span className={styles.summaryItem}>Failed: {summary.failed}</span>
      </div>
    </div>
  );
}
