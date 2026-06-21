/**
 * Message Status Table Component
 * Displays message status for selected date
 */

import { MESSAGE_STATUS, type MessageStatusValue } from '../../utils/whatsapp-send-constants';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import styles from '../../routes/WhatsAppSend.module.css';
import { formatISODate } from '../../core/utils';

/**
 * WhatsApp-style delivery indicator for the Status column (Font Awesome):
 *  - 1 gray tick   (fa-check)         → sent to server
 *  - 2 gray ticks  (fa-check-double)  → delivered to device
 *  - 2 blue ticks  (fa-check-double)  → read / played
 *  - clock         (fa-clock)         → not sent yet / ready to resend
 *  - alert         (fa-circle-exclamation) → failed / invalid phone
 */
function StatusTicks({ status }: { status: MessageStatusValue }) {
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

export interface MessageItem {
  status: MessageStatusValue;
  timeSent?: string;
  sentAt?: string;
  timestamp?: string;
  patientName?: string;
  name?: string;
  patient?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  message?: string;
  messageText?: string;
  content?: string;
}

export interface MessageSummary {
  total: number;
  pending: number;
  ready: number;
  server: number;
  device: number;
  read: number;
  played: number;
  failed: number;
}

interface MessageStatusTableProps {
  messages: MessageItem[];
  loading: boolean;
  currentDate: string;
  formatDisplayDate: (date: string) => string;
  MESSAGE_STATUS_TEXT: Record<MessageStatusValue, string>;
  MESSAGE_STATUS_CLASS: Record<MessageStatusValue, string>;
  escapeHtml: (text: string) => string;
  summary: MessageSummary;
}

export default function MessageStatusTable({
  messages,
  loading,
  currentDate,
  formatDisplayDate,
  MESSAGE_STATUS_TEXT,
  MESSAGE_STATUS_CLASS,
  escapeHtml,
  summary,
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

  const getStatusText = (status: MessageStatusValue): string => {
    return MESSAGE_STATUS_TEXT[status] || 'Unknown';
  };

  const getStatusClass = (status: MessageStatusValue): string => {
    return MESSAGE_STATUS_CLASS[status] || 'status-unknown';
  };

  const getTimeSent = (msg: MessageItem): string => {
    if (msg.timeSent) {
      return new Date(msg.timeSent).toLocaleTimeString();
    } else if (msg.sentAt) {
      return new Date(msg.sentAt).toLocaleTimeString();
    } else if (msg.timestamp) {
      return new Date(msg.timestamp).toLocaleTimeString();
    }
    return 'Not sent';
  };

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
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((msg, index) => {
              const statusText = getStatusText(msg.status);
              const statusClass = getStatusClass(msg.status);
              const timeSent = getTimeSent(msg);

              const patientName = msg.patientName || msg.name || msg.patient || 'N/A';
              const rawPhone = msg.phone || msg.phoneNumber || msg.mobile || '';
              const phoneNumber = rawPhone ? formatPhoneForDisplay(rawPhone) : 'N/A';
              const messageText = msg.message || msg.messageText || msg.content || '';

              const messagePreview =
                messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');

              return (
                <tr key={`${rawPhone || 'na'}-${timeSent}-${index}`} className={`status-row ${statusClass}`}>
                  <td className={styles.patientName}>
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(patientName) }} />
                  </td>
                  <td className={styles.phoneNumber}>
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(phoneNumber) }} />
                  </td>
                  <td className={styles.statusCell}>
                    <span className={styles.waStatus}>
                      <StatusTicks status={msg.status} />
                      {statusText}
                    </span>
                  </td>
                  <td className={styles.timeSent}>{timeSent}</td>
                  <td className={styles.messagePreview} title={messageText}>
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(messagePreview) }} />
                  </td>
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
