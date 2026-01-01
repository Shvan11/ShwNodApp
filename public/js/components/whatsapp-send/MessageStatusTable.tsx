/**
 * Message Status Table Component
 * Displays message status for selected date
 */

import { MessageStatusValue } from '../../utils/whatsapp-send-constants';

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
      <div className="results-placeholder">
        <p className="placeholder-text">
          <span className="status-icon" aria-hidden="true">
            ⏳
          </span>
          Loading message status...
        </p>
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const isToday = currentDate === todayStr;
    const isPast = currentDate < todayStr;

    let message = '';
    if (isPast) {
      message = 'No messages were sent on this date';
    } else if (isToday) {
      message = 'No messages sent yet today';
    } else {
      message = 'No messages scheduled for this date';
    }

    return (
      <div className="results-placeholder">
        <p className="placeholder-text">
          <span className="status-icon" aria-hidden="true">
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
    <div className="message-status-table">
      <h3>Message Status for {formatDisplayDate(currentDate)}</h3>
      <div className="table-responsive">
        <table className="status-table">
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
              const phoneNumber = msg.phone || msg.phoneNumber || msg.mobile || 'N/A';
              const messageText = msg.message || msg.messageText || msg.content || '';

              const messagePreview =
                messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');

              return (
                <tr key={index} className={`status-row ${statusClass}`}>
                  <td className="patient-name">
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(patientName) }} />
                  </td>
                  <td className="phone-number">
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(phoneNumber) }} />
                  </td>
                  <td className="status-cell">
                    <span className={`status-indicator ${statusClass}`}></span>
                    {statusText}
                  </td>
                  <td className="time-sent">{timeSent}</td>
                  <td className="message-preview" title={messageText}>
                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(messagePreview) }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-summary">
        <span className="summary-item">Total: {summary.total}</span>
        <span className="summary-item">Pending: {summary.pending}</span>
        <span className="summary-item">Server: {summary.server}</span>
        <span className="summary-item">Device: {summary.device}</span>
        <span className="summary-item">Read: {summary.read}</span>
        <span className="summary-item">Played: {summary.played}</span>
        <span className="summary-item">Failed: {summary.failed}</span>
      </div>
    </div>
  );
}
