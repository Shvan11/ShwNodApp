import { useState, useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import type { StatusRow } from '@shared/contracts/messaging.contract';
import * as messagingContract from '@shared/contracts/messaging.contract';
import { useDateManager } from '../hooks/useDateManager';
import { useWhatsAppSync } from '../hooks/useWhatsAppSync';
import { useMessageCount } from '../hooks/useMessageCount';
import { useMessageStatus } from '../hooks/useMessageStatus';
import { useReminderResend, resendReminder, resendAllFailed } from '../hooks/useReminderResend';
import { useToast } from '../contexts/ToastContext';
import { useAuthUser } from '../contexts/GlobalStateContext';
import DateSelector from '../components/whatsapp-send/DateSelector';
import GroupSettings from '../components/whatsapp-send/GroupSettings';
import ConnectionStatus from '../components/whatsapp-send/ConnectionStatus';
import ProgressBar from '../components/whatsapp-send/ProgressBar';
import ActionButtons from '../components/whatsapp-send/ActionButtons';
import MessageStatusTable from '../components/whatsapp-send/MessageStatusTable';
import LookupContextMenu, { type LookupMenuItem } from '../components/react/LookupContextMenu';
import { API_ENDPOINTS, MESSAGE_STATUS } from '../utils/whatsapp-send-constants';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';

// WhatsApp send page styles - CSS Module
import styles from './WhatsAppSend.module.css';

/** How long the Reset / Email buttons stay armed for their confirming second click. */
const CONFIRM_WINDOW_MS = 3000;

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

/** `/api/email/send-appointments` answers raw (no `data` key), which the funnel passes through. */
interface EmailSendResult {
  appointmentCount?: number;
}

/** `/api/wa/send` answers raw too; `alreadyInProgress` says another batch holds the lock. */
interface StartSendResult {
  alreadyInProgress?: boolean;
}

export default function WhatsAppSend() {
  // Toast notifications (unified global system)
  const toast = useToast();

  // Date management
  const { currentDate, dateOptions, setCurrentDate, sendability } = useDateManager();

  // Group settings and pairing are front-desk/admin (FE-F16-4).
  const user = useAuthUser();
  const canManageWhatsApp = roleCaps(user?.role as UserRole | undefined).manageWhatsApp;

  // SSE connection and state
  const {
    connectionStatus,
    clientReady,
    sendingProgress,
    messageStatusUpdate,
    unconfirmedSend,
  } = useWhatsAppSync();

  // Message count
  const {
    loading: countLoading,
    error: countError,
    messageCount,
    displayMessage,
    refresh: refreshMessageCount
  } = useMessageCount(currentDate);

  // Message status table
  const {
    messages,
    loading: statusLoading,
    summary,
    refresh: refreshMessageStatus,
  } = useMessageStatus(currentDate, messageStatusUpdate);

  // Reset / Email: armed by a first click, fired by a second within the window.
  // One timer per button, cleared when it fires or the page goes, so an earlier
  // click's timer can't disarm a later one, and a click while the request runs
  // can't fire it again (FE-F16-11).
  const [resetConfirm, setResetConfirm] = useState(false);
  const [emailConfirm, setEmailConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
    },
    []
  );

  const [starting, setStarting] = useState(false);
  const sendingInProgress = (sendingProgress.started && !sendingProgress.finished) || starting;

  // What this tab is already re-sending — module state, so it survives leaving
  // and coming back to /send (FE-F16-7).
  const resend = useReminderResend();

  // Right-click context menu on a status-table row (resend / copy fallbacks)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: StatusRow } | null>(
    null
  );

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

  // A batch that just ended changes the count ("22 ready" → "0 ready, 22 already
  // sent") and the table. Nothing refreshed the count banner, so it still offered
  // the 22 after they had gone (FE-F16-11).
  const batchFinished = sendingProgress.started && sendingProgress.finished;
  useEffect(() => {
    if (!batchFinished) return;
    void refreshMessageStatus();
    void refreshMessageCount();
  }, [batchFinished, refreshMessageStatus, refreshMessageCount]);

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
    if (resetting) return;
    if (!resetConfirm) {
      setResetConfirm(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setResetConfirm(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setResetConfirm(false);
    setResetting(true);

    try {
      const result = await postJSON<messagingContract.ResetResponse>(
        API_ENDPOINTS.MESSAGE_RESET(currentDate),
        {},
        { schema: messagingContract.reset.response }
      );
      toast.success(`Reset completed: ${result.appointmentsReset} appointments reset`);
      await refreshMessageCount();
      await refreshMessageStatus();
    } catch (error) {
      toast.error(`Failed to reset: ${httpErrorMessage(error, 'Unknown error')}`);
    } finally {
      setResetting(false);
    }
  }, [resetting, resetConfirm, currentDate, toast, refreshMessageCount, refreshMessageStatus]);

  // Handle send email
  const handleSendEmail = useCallback(async () => {
    if (emailing) return;
    if (!emailConfirm) {
      setEmailConfirm(true);
      if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
      emailTimerRef.current = setTimeout(() => setEmailConfirm(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (emailTimerRef.current) clearTimeout(emailTimerRef.current);
    emailTimerRef.current = null;
    setEmailConfirm(false);
    setEmailing(true);

    try {
      const result = await postJSON<EmailSendResult>(API_ENDPOINTS.SEND_EMAIL(currentDate), {});
      toast.success(`Email sent successfully! ${result.appointmentCount ?? 0} appointments`);
    } catch (error) {
      toast.error(`Failed to send email: ${httpErrorMessage(error, 'Unknown error')}`);
    } finally {
      setEmailing(false);
    }
  }, [emailing, emailConfirm, currentDate, toast]);

  // Handle start sending
  const handleStartSending = useCallback(async () => {
    if (!clientReady) {
      toast.error('WhatsApp client is not ready');
      return;
    }
    if (starting) return;

    setStarting(true);
    try {
      const result = await postJSON<StartSendResult>(API_ENDPOINTS.WA_SEND, { date: currentDate });
      if (result.alreadyInProgress) {
        toast.warning('A sending batch is already in progress — wait for it to finish');
      }
      // A started batch reports itself: the server's `started` frame drives the
      // panel and the bar, and its `finished` frame says how it ended.
    } catch (error) {
      toast.error(`Failed to start sending: ${httpErrorMessage(error, 'Unknown error')}`);
    } finally {
      setStarting(false);
    }
  }, [clientReady, starting, currentDate, toast]);

  // ---- Row context menu: re-send / copy fallbacks ----------------------------

  const handleRowContextMenu = useCallback((event: ReactMouseEvent, msg: StatusRow) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, msg });
  }, []);

  const rowName = (m: StatusRow) => m.patientName || m.name || 'patient';

  // Failed rows only (ack ERROR) — the "re-send to those failed numbers alone" path.
  const failedMessages = messages.filter(
    (m) => m.status === MESSAGE_STATUS.FAILED && m.appointmentId != null
  );

  const handleResendRow = useCallback(
    (msg: StatusRow) => {
      if (msg.appointmentId == null) return;
      void resendReminder({ appointmentId: msg.appointmentId, name: rowName(msg) }, currentDate);
    },
    [currentDate]
  );

  const handleResendAllFailed = useCallback(() => {
    void resendAllFailed(
      failedMessages.map((m) => ({ appointmentId: m.appointmentId as number, name: rowName(m) })),
      currentDate
    );
  }, [failedMessages, currentDate]);

  const handleCopyMessage = useCallback(
    async (msg: StatusRow) => {
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
    async (msg: StatusRow) => {
      const rawPhone = msg.phone;
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
          disabled:
            !clientReady ||
            sendingInProgress ||
            !!resend.bulk ||
            contextMenu.msg.appointmentId == null ||
            resend.inFlight.has(contextMenu.msg.appointmentId),
          onClick: () => handleResendRow(contextMenu.msg),
        },
        ...(failedMessages.length > 0 || resend.bulk
          ? [
              {
                key: 'resend-failed',
                label: resend.bulk
                  ? `Re-sending failed… ${resend.bulk.done} of ${resend.bulk.total}`
                  : `Re-send all failed (${failedMessages.length})`,
                icon: 'fa-rotate-right',
                disabled: !clientReady || sendingInProgress || !!resend.bulk,
                onClick: handleResendAllFailed,
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
          countFailed={!!countError}
          resetConfirm={resetConfirm}
          emailConfirm={emailConfirm}
          resetting={resetting}
          emailing={emailing}
          sendability={sendability}
        />

        {/* Appointment-list-to-group settings — front desk / admin only (FE-F16-4) */}
        {canManageWhatsApp && <GroupSettings />}

        {/* Status and Action Area */}
        <section className={styles.statusArea}>
          <ConnectionStatus
            connectionStatus={connectionStatus}
            clientReady={clientReady}
            sendingProgress={sendingProgress}
            currentDate={currentDate}
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
            nothingToSend={messageCount != null && messageCount.eligibleForMessaging <= 0}
          />
        </section>

        {/* Results and Content Area */}
        <section className={styles.contentArea}>
          <div id="tableContainer" className={styles.resultsContainer} role="region" aria-label="Message sending results">
            <MessageStatusTable
              messages={messages}
              loading={statusLoading}
              currentDate={currentDate}
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
