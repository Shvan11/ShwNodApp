/**
 * WhatsApp ↔ event-bus wiring and the startup auto-init, lifted out of
 * `index.ts` (C3 — pure move).
 *
 * The service emits domain events; these handlers persist them into
 * `messageState` and re-emit them onto the in-process bus, from which
 * `sse-whatsapp.ts` turns them into SSE frames.
 */
import type { EventEmitter } from 'events';
import whatsappService from '../services/messaging/whatsapp.js';
// The stored-session probe is a pure filesystem check (no client state), so it
// lives beside the other LocalAuth-profile helpers rather than on the service.
import { checkExistingSession } from '../services/messaging/whatsapp-session-files.js';
import messageState from '../services/messaging/messageState.js';
import { MessageStatus } from '../services/messaging/message-status.js';
import { InternalEmitterEvents } from '../services/messaging/websocket-events.js';
import { log } from '../utils/logger.js';

/**
 * Person data for WhatsApp messaging
 */
interface MessagePerson {
  messageId: string;
  name: string;
  number: string;
  appointmentId?: number;
  error?: string;
  success?: string;
  [key: string]: unknown;
}

/**
 * WhatsApp client status
 */
interface WhatsAppStatus {
  state?: string;
  hasClient?: boolean;
}

/** Connect the WhatsApp service to the event bus and register its handlers. */
export function wireWhatsappEvents(wsEmitter: EventEmitter): void {
  // Connect WhatsApp service to WebSocket emitter
  log.debug('About to connect WhatsApp service...');
  log.info('Connecting WhatsApp service...');
  whatsappService.setEmitter(wsEmitter);
  log.debug('WhatsApp service connected');

  // Set up comprehensive WhatsApp event handlers
  whatsappService.on('MessageSent', async (person: MessagePerson) => {
      log.info("MessageSent event fired:", { person });
      try {
          await messageState.addPerson(person);

          if (wsEmitter) {
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
                  messageId: person.messageId,
                  status: MessageStatus.SERVER,
                  patientName: person.name,
                  phone: person.number,
                  timeSent: new Date().toISOString(),
                  message: '',
                  appointmentId: person.appointmentId
              });

              const stats = messageState.dump();
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, {
                  sent: stats.sentMessages,
                  failed: stats.failedMessages,
                  finished: stats.finishedSending
              });
          }

          log.info("MessageSent processed successfully");
      } catch (error) {
          log.error("Error handling MessageSent event:", { error });
      }
  });

  whatsappService.on('MessageFailed', async (person: MessagePerson) => {
      log.info("MessageFailed event fired:", { person });
      try {
          person.success = '&times;';
          await messageState.addPerson(person);

          if (wsEmitter) {
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
                  messageId: person.messageId || `failed_${Date.now()}`,
                  status: MessageStatus.ERROR,
                  patientName: person.name,
                  phone: person.number,
                  timeSent: null,
                  message: '',
                  error: person.error,
                  appointmentId: person.appointmentId
              });

              const stats = messageState.dump();
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, {
                  sent: stats.sentMessages,
                  failed: stats.failedMessages,
                  finished: stats.finishedSending
              });
          }

          log.info("MessageFailed processed successfully");
      } catch (error) {
          log.error("Error handling MessageFailed event:", { error });
      }
  });

  whatsappService.on('finishedSending', async () => {
      log.info("finishedSending event fired");
      try {
          await messageState.setFinishedSending(true);

          if (wsEmitter) {
              const stats = messageState.dump();
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_FINISHED, {
                  finished: true,
                  sent: stats.sentMessages,
                  failed: stats.failedMessages,
                  total: stats.sentMessages + stats.failedMessages
              });
          }
      } catch (error) {
          log.error("Error handling finishedSending event:", { error });
      }
  });

  whatsappService.on('ClientIsReady', async () => {
      log.info("ClientIsReady event fired");
      try {
          await messageState.setClientReady(true);

          if (wsEmitter) {
              wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, { clientReady: true });
          }

          log.info("✅ WhatsApp client is ready and state updated");
      } catch (error) {
          log.error("❌ Error updating WhatsApp client ready state:", { error });
      }
  });

  // NOTE: there is deliberately no whatsappService.on('qr') handler here.
  // handleQR() in the service already stores the QR in messageState AND emits
  // WHATSAPP_QR_UPDATED carrying a rendered data URL. A handler here would emit
  // a SECOND frame for the same QR holding the RAW code string — and the auth
  // page renders that payload straight into <img src=…>, so whichever frame
  // landed last decided whether the user saw a QR or a broken image.
}

// ===========================================
// WHATSAPP INITIALIZATION
// ===========================================

/**
 * Initialize WhatsApp client automatically on startup
 * Can be controlled via WHATSAPP_AUTO_INIT environment variable
 */
export async function initializeWhatsAppOnStartup(): Promise<void> {
  // Check if auto-initialization is enabled (default: true)
  const autoInit = process.env.WHATSAPP_AUTO_INIT !== 'false';

  if (!autoInit) {
    log.info('📱 WhatsApp auto-initialization disabled via WHATSAPP_AUTO_INIT=false');
    return;
  }

  log.info('📱 Starting automatic WhatsApp client initialization...');

  try {
    // Add a small delay to ensure all services are ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if WhatsApp service is ready
    if (!whatsappService) {
      log.info('⚠️  WhatsApp service not available, skipping auto-initialization');
      return;
    }

    // Check current state
    const currentState: WhatsAppStatus = whatsappService.getStatus();
    log.info(`📱 Current WhatsApp state: ${currentState.state || 'unknown'}`);

    // Only initialize if client is disconnected
    if (currentState.state === 'DISCONNECTED' || currentState.state === 'ERROR') {
      // Check for existing session first
      const hasExistingSession = await checkExistingSession();

      if (hasExistingSession) {
        log.info('📱 Found existing session - initializing WhatsApp client...');
      } else {
        log.info('📱 No existing session - initializing WhatsApp client (will require QR scan)...');
      }

      // Fire-and-forget — do NOT race a short timeout. A healthy session restore
      // can take up to SESSION_RESTORATION_TIMEOUT (120s), and the auth-
      // stabilization window alone is 60s, so the old 60s race ALWAYS "failed" on
      // a good restore, detached, and logged a misleading "Initialization timeout"
      // while init actually kept running underneath. initialize() owns its own
      // timeouts + reconnect + ready-watchdog; the SSE channel reports ready/QR.
      // Just kick it off and log the eventual outcome.
      whatsappService
        .initialize()
        .then((ready) =>
          log.info(
            ready
              ? '✅ WhatsApp client connected from restored session'
              : '✅ WhatsApp client initialized — waiting for QR scan'
          )
        )
        .catch((error: Error) =>
          log.warn('⚠️  WhatsApp initialization failed (will auto-recover):', {
            error: error.message,
          })
        );

    } else if (currentState.state === 'CONNECTED') {
      log.info('✅ WhatsApp client already connected');
    } else if (currentState.state === 'INITIALIZING') {
      log.info('📱 WhatsApp client already initializing');
    } else {
      log.info(`📱 WhatsApp client in state: ${currentState.state}, skipping initialization`);
    }

  } catch (error) {
    // Don't fail the entire application if WhatsApp initialization fails
    log.warn('⚠️  WhatsApp auto-initialization failed (application will continue):', { error: (error as Error).message });
    log.info('💡 WhatsApp can be initialized manually later via the web interface');
  }
}
