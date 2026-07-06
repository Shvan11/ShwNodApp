import { useState, useCallback, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useDateManager } from '../hooks/useDateManager';
import { useWhatsAppSync } from '../hooks/useWhatsAppSync';
import { useMessageCount } from '../hooks/useMessageCount';
import { useMessageStatus } from '../hooks/useMessageStatus';
import { useToast } from '../contexts/ToastContext';
import DateSelector from '../components/whatsapp-send/DateSelector';
import GroupSettings from '../components/whatsapp-send/GroupSettings';
import ConnectionStatus from '../components/whatsapp-send/ConnectionStatus';
import ProgressBar from '../components/whatsapp-send/ProgressBar';
import ActionButtons from '../components/whatsapp-send/ActionButtons';
import MessageStatusTable, { type MessageItem } from '../components/whatsapp-send/MessageStatusTable';
import LookupContextMenu, { type LookupMenuItem } from '../components/react/LookupContextMenu';
import { API_ENDPOINTS, MESSAGE_STATUS } from '../utils/whatsapp-send-constants';
import { APIClient } from '../utils/whatsapp-api-client';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';
import * as messagingContract from '@shared/contracts/messaging.contract';
import * as waContract from '@shared/contracts/whatsapp.contract';

// WhatsApp send page styles - CSS Module
import styles from './WhatsAppSend.module.css';

import type { WhatsAppResetResponse, EmailResponse } from '@/types/api.types';

const apiClient = new APIClient();

/**
 * Copy text to the clipboard. navigator.clipboard needs a secure context
 * (https / localhost); the textarea+execCommand path covers plain-http LAN use.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Gap between bulk resends — mirrors the batch sender's per-message spacing. */
const BULK_RESEND_GAP_MS = 2000;

export default function WhatsAppSend() {
  // Toast notifications (unified global system)
  const toast = useToast();

  // Date management
  const { currentDate, dateOptions, setCurrentDate, sendability } = useDateManager();

  // SSE connection and state
  const {
    connectionStatus,
    clientReady,
    sendingProgress,
    messageStatusUpdate,
    unconfirmedSend,
    requestInitialState
  } = useWhatsAppSync(currentDate);

  // Message count
  const {
    loading: countLoading,
    displayMessage,
    refresh: refreshMessageCount
  } = useMessageCount(currentDate);

  // Message status table
  const {
    messages,
    loading: statusLoading,
    summary,
    refresh: refreshMessageStatus,
    formatDisplayDate,
    MESSAGE_STATUS_TEXT,
    MESSAGE_STATUS_CLASS,
    escapeHtml
  } = useMessageStatus(currentDate, messageStatusUpdate);

  // UI state
  const [resetConfirm, setResetConfirm] = useState(false);
  const [emailConfirm, setEmailConfirm] = useState(false);

  const sendingInProgress = sendingProgress.started && !sendingProgress.finished;

  // Right-click context menu on a status-table row (resend / copy fallbacks)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: MessageItem } | null>(
    null
  );
  const [bulkResending, setBulkResending] = useState(false);

  // Zero-ack batch warning from the server: the last batch reported "sent" but
  // WhatsApp never confirmed a single message — surface it loudly and refresh.
  useEffect(() => {
    if (!unconfirmedSend) return;
    toast.error(
      unconfirmedSend.message ||
        'WhatsApp did not confirm the last batch — the messages were most likely NOT delivered.',
      30000
    );
    void refreshMessageStatus();
    void refreshMessageCount();
  }, [unconfirmedSend, toast, refreshMessageStatus, refreshMessageCount]);

  // Handle date change
  const handleDateChange = useCallback((newDate: string) => {
    setCurrentDate(newDate);
  }, [setCurrentDate]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    await refreshMessageCount();
  }, [refreshMessageCount]);

  // Handle reset messages
  const handleReset = useCallback(async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
      return;
    }

    try {
      const result = await apiClient.post<WhatsAppResetResponse>(API_ENDPOINTS.MESSAGE_RESET(currentDate));

      if (result.success) {
        toast.success(
          `Reset completed: ${result.data?.appointmentsReset || 0} appointments reset`
        );
        await refreshMessageCount();
        await refreshMessageStatus();
      } else {
        throw new Error(result.error || 'Reset failed');
      }
    } catch (error) {
      toast.error(`Failed to reset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setResetConfirm(false);
    }
  }, [resetConfirm, currentDate, toast, refreshMessageCount, refreshMessageStatus]);

  // Handle send email
  const handleSendEmail = useCallback(async () => {
    if (!emailConfirm) {
      setEmailConfirm(true);
      setTimeout(() => setEmailConfirm(false), 3000);
      return;
    }

    try {
      const result = await apiClient.post<EmailResponse>(
        API_ENDPOINTS.SEND_EMAIL(currentDate),
        null,
        { expectedFields: ['success'] }
      );

      if (result.success) {
        toast.success(
          `Email sent successfully! ${result.appointmentCount} appointments`
        );
      } else {
        throw new Error(result.error || 'Email sending failed');
      }
    } catch (error) {
      toast.error(`Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setEmailConfirm(false);
    }
  }, [emailConfirm, currentDate, toast]);

  // Handle start sending
  const handleStartSending = useCallback(async () => {
    if (!clientReady) {
      toast.error('WhatsApp client is not ready');
      return;
    }

    try {
      const result = await apiClient.get<{ alreadyInProgress?: boolean }>(
        API_ENDPOINTS.WA_SEND(currentDate)
      );
      if (result.alreadyInProgress) {
        toast.warning('A sending batch is already in progress — wait for it to finish');
      } else {
        toast.success('Messages sending started');
      }
    } catch (error) {
      toast.error(`Failed to start sending: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [clientReady, currentDate, toast]);

  // ---- Row context menu: re-send / copy fallbacks ----------------------------

  const handleRowContextMenu = useCallback((event: ReactMouseEvent, msg: MessageItem) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, msg });
  }, []);

  /** Re-send one appointment's reminder; returns true on success. */
  const resendOne = useCallback(
    async (appointmentId: number, name: string, notify: boolean): Promise<boolean> => {
      try {
        await postJSON(
          API_ENDPOINTS.WA_RESEND,
          { appointmentId },
          { schema: waContract.resendAppointment.response }
        );
        if (notify) toast.success(`Reminder re-sent to ${name}`);
        return true;
      } catch (error) {
        if (notify) {
          toast.error(`Re-send to ${name} failed: ${httpErrorMessage(error, 'Unknown error')}`);
        }
        return false;
      }
    },
    [toast]
  );

  const handleResendRow = useCallback(
    async (msg: MessageItem) => {
      if (msg.appointmentId == null) return;
      const name = msg.patientName || msg.name || 'patient';
      await resendOne(msg.appointmentId, name, true);
      await refreshMessageStatus();
      await refreshMessageCount();
    },
    [resendOne, refreshMessageStatus, refreshMessageCount]
  );

  // Failed rows only (ack ERROR) — the "re-send to those failed numbers alone" path.
  const failedMessages = messages.filter(
    (m) => m.status === MESSAGE_STATUS.FAILED && m.appointmentId != null
  );

  const handleResendAllFailed = useCallback(async () => {
    if (bulkResending || failedMessages.length === 0) return;
    setBulkResending(true);
    toast.info(`Re-sending ${failedMessages.length} failed message(s)…`);
    let sent = 0;
    try {
      for (let i = 0; i < failedMessages.length; i++) {
        const m = failedMessages[i];
        const name = m.patientName || m.name || 'patient';
        if (await resendOne(m.appointmentId as number, name, false)) sent++;
        if (i < failedMessages.length - 1) await sleep(BULK_RESEND_GAP_MS);
      }
    } finally {
      setBulkResending(false);
    }
    if (sent === failedMessages.length) {
      toast.success(`Re-sent all ${sent} failed message(s)`);
    } else {
      toast.warning(`Re-sent ${sent} of ${failedMessages.length} failed message(s) — check the table for reasons`);
    }
    await refreshMessageStatus();
    await refreshMessageCount();
  }, [bulkResending, failedMessages, resendOne, toast, refreshMessageStatus, refreshMessageCount]);

  const handleCopyMessage = useCallback(
    async (msg: MessageItem) => {
      if (msg.appointmentId == null) return;
      try {
        const data = await fetchJSON<messagingContract.MessageTextResponse>(
          API_ENDPOINTS.MESSAGE_TEXT(msg.appointmentId),
          { schema: messagingContract.messageText.response }
        );
        const ok = await copyToClipboard(data.message);
        if (ok) toast.success('Message text copied — paste it into WhatsApp to send manually');
        else toast.error('Could not copy to clipboard');
      } catch (error) {
        toast.error(`Failed to fetch message text: ${httpErrorMessage(error, 'Unknown error')}`);
      }
    },
    [toast]
  );

  const handleCopyPhone = useCallback(
    async (msg: MessageItem) => {
      const rawPhone = msg.phone || msg.phoneNumber || msg.mobile || '';
      // Prefer the server's country-coded form; fall back to the raw row value.
      let phone = rawPhone;
      if (msg.appointmentId != null) {
        try {
          const data = await fetchJSON<messagingContract.MessageTextResponse>(
            API_ENDPOINTS.MESSAGE_TEXT(msg.appointmentId),
            { schema: messagingContract.messageText.response }
          );
          if (data.phone) phone = `+${data.phone}`;
        } catch {
          // keep raw
        }
      }
      if (!phone) {
        toast.error('No phone number on this row');
        return;
      }
      const ok = await copyToClipboard(phone);
      if (ok) toast.success(`Phone number copied: ${phone}`);
      else toast.error('Could not copy to clipboard');
    },
    [toast]
  );

  const contextMenuItems: LookupMenuItem[] = contextMenu
    ? [
        {
          key: 'resend',
          label: 'Re-send message',
          icon: 'fa-paper-plane',
          disabled: !clientReady || sendingInProgress || bulkResending || contextMenu.msg.appointmentId == null,
          onClick: () => void handleResendRow(contextMenu.msg),
        },
        ...(failedMessages.length > 0
          ? [
              {
                key: 'resend-failed',
                label: `Re-send all failed (${failedMessages.length})`,
                icon: 'fa-rotate-right',
                disabled: !clientReady || sendingInProgress || bulkResending,
                onClick: () => void handleResendAllFailed(),
              },
            ]
          : []),
        {
          key: 'copy-message',
          label: 'Copy message text',
          icon: 'fa-copy',
          disabled: contextMenu.msg.appointmentId == null,
          onClick: () => void handleCopyMessage(contextMenu.msg),
        },
        {
          key: 'copy-phone',
          label: 'Copy phone number',
          icon: 'fa-phone',
          onClick: () => void handleCopyPhone(contextMenu.msg),
        },
      ]
    : [];

  // Check for auth completion redirect
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCompleted = urlParams.get('authCompleted');

    if (authCompleted) {
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Request initial state to refresh client status
      requestInitialState();
    }
  }, [requestInitialState]);

  return (
    <div id="app">
      <main className={`${styles.container} ${styles.mainLayout}`} role="main">
        <div className={styles.pageHeaderArea}>
          <h2>WhatsApp Messaging</h2>
          <Link
            to="/auth"
            className={styles.connectionStatus}
            aria-live="polite"
            title="Open WhatsApp authentication page"
          >
            <span
              className={`${styles.connectionIndicator} ${
                clientReady ? styles.connected : styles.disconnected
              }`}
              aria-hidden="true"
            ></span>
            <span className={styles.connectionText}>
              {clientReady ? 'Client Ready' : 'Authentication Required'}
            </span>
          </Link>
        </div>

        {/* Date Selection Panel */}
        <DateSelector
          currentDate={currentDate}
          dateOptions={dateOptions}
          onDateChange={handleDateChange}
          displayMessage={displayMessage}
          onRefresh={handleRefresh}
          onReset={handleReset}
          onSendEmail={handleSendEmail}
          loading={countLoading}
          resetConfirm={resetConfirm}
          emailConfirm={emailConfirm}
          sendability={sendability}
        />

        {/* Appointment-list-to-group settings */}
        <GroupSettings />

        {/* Status and Action Area */}
        <section className={styles.statusArea}>
          <ConnectionStatus
            connectionStatus={connectionStatus}
            clientReady={clientReady}
            sendingProgress={sendingProgress}
          />

          {/* Progress Display for Message Sending */}
          <ProgressBar sendingProgress={sendingProgress} />

          {/* Main Action Button */}
          <ActionButtons
            clientReady={clientReady}
            onStartSending={handleStartSending}
            sendingInProgress={sendingInProgress}
            sendingProgress={sendingProgress}
            sendability={sendability}
          />
        </section>

        {/* Results and Content Area */}
        <section className={styles.contentArea}>
          <div id="tableContainer" className={styles.resultsContainer} role="region" aria-label="Message sending results">
            <MessageStatusTable
              messages={messages}
              loading={statusLoading}
              currentDate={currentDate}
              formatDisplayDate={formatDisplayDate}
              MESSAGE_STATUS_TEXT={MESSAGE_STATUS_TEXT}
              MESSAGE_STATUS_CLASS={MESSAGE_STATUS_CLASS}
              escapeHtml={escapeHtml}
              summary={summary}
              onRowContextMenu={handleRowContextMenu}
            />
          </div>
        </section>
      </main>

      {/* Right-click resend/copy menu on a status row */}
      {contextMenu && (
        <LookupContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Toast Notifications now handled globally by ToastProvider in App.tsx */}
    </div>
  );
}
