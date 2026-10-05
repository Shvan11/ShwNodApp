/**
 * Connection Status Component
 * Displays the stream, client and batch status in one line.
 */

import { UI_STATES, type UIState } from '../../utils/whatsapp-send-constants';
import type { SendingProgress } from '../../hooks/useWhatsAppSync';
import styles from '../../routes/WhatsAppSend.module.css';

interface ConnectionStatusProps {
  connectionStatus: UIState;
  clientReady: boolean;
  sendingProgress: SendingProgress;
  /** The date on screen: a finished batch is reported only on its own date. */
  currentDate: string;
}

type Tone = 'connected' | 'sending' | 'error' | 'disconnected';

/**
 * The order is the point (FE-F16-12): a dropped stream comes first, because
 * while it is down every other fact on the panel — the client's ready flag, the
 * batch's counts — is the last one heard, not the current one.
 */
function describe({ connectionStatus, clientReady, sendingProgress: p, currentDate }: ConnectionStatusProps): {
  text: string;
  tone: Tone;
} {
  if (connectionStatus === UI_STATES.ERROR) {
    return { text: '❌ Lost the connection to the server — retrying…', tone: 'error' };
  }
  if (connectionStatus === UI_STATES.DISCONNECTED) {
    return { text: '🔌 Reconnecting to the server…', tone: 'disconnected' };
  }
  if (connectionStatus === UI_STATES.CONNECTING) {
    return { text: '🔄 Connecting...', tone: 'disconnected' };
  }

  if (p.started && !p.finished && p.total > 0) {
    return { text: `📤 Sending messages… ${p.sent + p.failed} of ${p.total}`, tone: 'sending' };
  }

  if (p.started && p.finished && p.date === currentDate) {
    if (p.error) {
      return {
        text: `⚠️ Sending stopped after ${p.sent + p.failed} of ${p.total}: ${p.error}`,
        tone: 'error',
      };
    }
    if (p.total === 0) {
      return { text: 'ℹ️ There were no messages to send for this date.', tone: 'connected' };
    }
    // "Handed to WhatsApp", not "delivered": the batch counts what WhatsApp
    // accepted. Delivery is the ticks in the table (FE-F16-11).
    return {
      text: `✅ Finished: ${p.sent} handed to WhatsApp, ${p.failed} failed. Delivery ticks appear in the table below.`,
      tone: p.failed > 0 ? 'error' : 'connected',
    };
  }

  if (clientReady) return { text: '✅ WhatsApp client is ready!', tone: 'connected' };
  return { text: '🔐 WhatsApp authentication required', tone: 'disconnected' };
}

const TONE_CLASS: Record<Tone, string | undefined> = {
  connected: styles.statusConnected,
  sending: styles.statusSending,
  error: styles.statusError,
  disconnected: styles.statusDisconnected,
};

export default function ConnectionStatus(props: ConnectionStatusProps) {
  const { text, tone } = describe(props);

  return (
    <div
      id="state"
      className={`${styles.statusPanel} ${TONE_CLASS[tone] ?? ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{text}</span>
    </div>
  );
}
