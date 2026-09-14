/**
 * WhatsApp SESSION routes — the QR/auth surface the WhatsApp settings screen polls,
 * and the client-lifecycle actions behind its buttons (restart, refresh QR, unlink,
 * initialize on demand).
 *
 * Split out of whatsapp.routes.ts (S2/C6).
 *
 * Mounted at `/api/wa`, immediately after whatsapp.routes.ts and in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Responses stay RAW (the client reads top-level fields via the raw apiClient — not
 * the `core/http` funnel), so these handlers deliberately do NOT wrap in `sendData`
 * where the original didn't.
 */

import { Router, type Request, type Response } from 'express';
import qrcode from 'qrcode';

// Services
import whatsapp from '../../services/messaging/whatsapp.js';
import messageState from '../../services/messaging/messageState.js';
import stateEvents from '../../services/messaging/stateEvents.js';

// Utilities
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';

const router = Router();

// ============================================================================
// WHATSAPP AUTHENTICATION & STATUS ROUTES
// ============================================================================

/**
 * Get WhatsApp QR code for authentication
 * GET /qr (mounted at /api/wa)
 * Returns QR code as base64 data url or error if not available
 */
router.get('/qr', authorize(FINANCE_ROLES), async (_req: Request, res: Response): Promise<void> => {
  try {
    // Just check if QR code is available
    if (!messageState || !messageState.qr) {
      log.warn('WhatsApp QR code not available');
      ErrorResponses.notFound(res, 'QR code', {
        details: 'QR code not available yet',
        status: 'waiting',
        timestamp: Date.now()
      });
      return;
    }

    // Convert the QR code string to a data url
    const qrImageUrl = await qrcode.toDataURL(messageState.qr, {
      margin: 4,
      scale: 6,
      errorCorrectionLevel: 'M'
    });

    // Send back as JSON with metadata
    res.json({
      qr: qrImageUrl,
      status: 'available',
      timestamp: Date.now(),
      expiryTime: Date.now() + 60000 // QR codes typically expire after 1 minute
    });
  } catch (error) {
    log.error('Error generating WhatsApp QR code image:', error);
    ErrorResponses.internalError(res, 'Error generating QR code', error as Error);
  }
});

/**
 * Get initial WhatsApp state (replaces the WS REQUEST_WHATSAPP_INITIAL_STATE RPC).
 * GET /initial-state (mounted at /api/wa)
 * Returns the same payload shape the WS handler used to push, so hooks can
 * prime themselves on mount / date-change / visibility / 30s QR-refresh.
 * Triggers on-demand init when QR viewers are connected.
 */
router.get('/initial-state', async (req: Request, res: Response): Promise<void> => {
  try {
    const mayPair =
      !!req.session?.userRole &&
      (FINANCE_ROLES as readonly string[]).includes(req.session.userRole);
    const stateDump = messageState.dump();
    const clientStatus = whatsapp.getStatus() as {
      state?: string;
      active?: boolean;
      initializing?: boolean;
      hasClient?: boolean;
      needsRelink?: boolean;
    };

    // Don't kick on-demand init while parked for a re-link (it would no-op in the
    // service anyway, but skip the emit entirely).
    if (messageState.activeQRViewers > 0 && !clientStatus.needsRelink) {
      stateEvents.emit('whatsapp_initialization_requested');
    }

    const isClientReady = stateDump.clientReady || clientStatus.active;
    const finished = stateDump.finishedSending;

    // Two distinct "no QR yet" situations, so the auth page never shows a
    // forever-empty QR box: `needsRelink` = session poisoned, manual re-link
    // required (parked); `restoring` = a live client mid-restore (a QR may still
    // be moments away, or it resolves to ready).
    const needsRelink = !!clientStatus.needsRelink;
    const restoring =
      !isClientReady &&
      !needsRelink &&
      !messageState.qr &&
      !!clientStatus.hasClient &&
      (clientStatus.state === 'INITIALIZING' || !!clientStatus.initializing);

    let html: string;
    if (isClientReady) {
      html = finished
        ? `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Finished</p>`
        : `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Sending...</p>`;
    } else if (needsRelink) {
      html = '<p>WhatsApp session expired — please re-link the device.</p>';
    } else if (messageState.qr && messageState.activeQRViewers > 0) {
      html = '<p>QR code ready - Please scan with WhatsApp</p>';
    } else if (restoring) {
      html = '<p>Restoring WhatsApp session...</p>';
    } else {
      html = '<p>Initializing the client...</p>';
    }

    let qrDataUrl: string | null = null;
    if (!isClientReady && messageState.qr) {
      try {
        qrDataUrl = await qrcode.toDataURL(messageState.qr, {
          margin: 4,
          scale: 6,
          errorCorrectionLevel: 'M'
        });
      } catch (error) {
        log.error('Failed to convert QR code to data url', { error: (error as Error).message });
        qrDataUrl = messageState.qr;
      }
    }

    res.json({
      success: true,
      htmltext: html,
      finished,
      clientReady: isClientReady,
      initializing: clientStatus.initializing || false,
      needsRelink,
      restoring,
      clientStatus,
      persons: messageState.persons || [],
      // The pairing QR is the one secret in this payload: whoever scans it links a
      // device to the clinic's WhatsApp account. `/qr` is FINANCE_ROLES; this
      // endpoint must not be the way around that gate. It stays open to every
      // staff session because GlobalStateContext reconciles `clientReady` from it
      // on every page load for every role — only the QR itself is withheld.
      qr: mayPair ? qrDataUrl : null,
      stats: stateDump,
      sentMessages: stateDump.sentMessages || 0,
      failedMessages: stateDump.failedMessages || 0,
      timestamp: Date.now()
    });
  } catch (error) {
    log.error('Error building WhatsApp initial state', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to fetch initial state', error as Error);
  }
});

// ============================================================================
// WHATSAPP CLIENT LIFECYCLE ROUTES
// ============================================================================

/**
 * Restart WhatsApp client
 * POST /restart (mounted at /api/wa)
 * Safely closes the existing client and creates a new one
 */
router.post(
  '/restart',
  authorize(FINANCE_ROLES),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Restarting WhatsApp client');

      const success = await whatsapp.restart();

      res.json({
        success: true,
        message: 'WhatsApp client restart initiated',
        result: success ? 'restart_initiated' : 'restart_failed'
      });
    } catch (error) {
      log.error('Error restarting WhatsApp client:', error);
      ErrorResponses.internalError(res, 'Failed to restart WhatsApp client', error as Error);
    }
  }
);

/**
 * Refresh the WhatsApp QR code.
 * POST /refresh-qr (mounted at /api/wa)
 *
 * The displayed QR is already live-pushed on every whatsapp-web.js rotation via the
 * SSE channel, so re-fetching state can't change it — the only way to mint a *new*
 * code is a fresh client init. This force-restarts the client to do exactly that.
 *
 * It is FIRE-AND-FORGET (returns 200 immediately, restarts in the background): a
 * blocking restart can't be awaited over HTTP because, in QR mode, the init promise
 * doesn't resolve until a scan or FRESH_AUTH_TIMEOUT (90s) — far past the 30s request
 * timeout. The fresh QR arrives over `GET /api/sse/whatsapp` within a few seconds.
 */
router.post('/refresh-qr', authorize(FINANCE_ROLES), (_req: Request, res: Response): void => {
  try {
    log.info('WhatsApp QR refresh requested - restarting client to mint a new QR');
    res.json({
      success: true,
      message: 'Refreshing QR code',
      action: 'refresh_qr_requested',
      timestamp: Date.now()
    });

    setImmediate(async () => {
      try {
        await whatsapp.restart();
        log.info('QR refresh restart completed');
      } catch (error) {
        log.error('QR refresh restart failed:', (error as Error).message);
      }
    });
  } catch (error) {
    log.error('Error handling WhatsApp QR refresh request:', error);
    ErrorResponses.internalError(res, 'Failed to process QR refresh request', error as Error);
  }
});

/**
 * Re-link the WhatsApp client.
 * POST /unlink (mounted at /api/wa)
 *
 * Clears the stored session through whatsapp-web.js's OWN api (a clean
 * client.logout() when the page is healthy, else destroy + LocalAuth.logout() —
 * never our own fs delete of .wwebjs_auth) and starts fresh so a new QR appears.
 * This is the only recovery for a poisoned "authenticated but never ready"
 * session (the parked `needs_relink` state); the Re-link button lands here.
 *
 * FIRE-AND-FORGET (returns 200 immediately): the clear + fresh init can exceed
 * the 30s request timeout, so the outcome is reported over `GET /api/sse/whatsapp`
 * — a fresh QR (`whatsapp_qr_updated`) on success, or a `needs_relink`
 * client-ready frame if the clear couldn't complete.
 */
router.post('/unlink', authorize(FINANCE_ROLES), (_req: Request, res: Response): void => {
  try {
    log.info('WhatsApp re-link requested — clearing session for a fresh QR');
    res.json({
      success: true,
      message: 'Re-linking WhatsApp — a new QR is on the way',
      action: 'unlink_requested',
      timestamp: Date.now()
    });

    setImmediate(async () => {
      try {
        const result = await whatsapp.unlink();
        if (result.success) {
          log.info('WhatsApp unlink completed — fresh init started');
        } else {
          log.warn('WhatsApp unlink reported failure', { error: result.error });
        }
      } catch (error) {
        log.error('WhatsApp unlink failed:', (error as Error).message);
      }
    });
  } catch (error) {
    log.error('Error handling WhatsApp unlink request:', error);
    ErrorResponses.internalError(res, 'Failed to process re-link request', error as Error);
  }
});

/**
 * Manually start the WhatsApp client.
 * POST /initialize (mounted at /api/wa)
 * The in-app "Start WhatsApp" button — calls whatsapp.initialize() directly, so
 * it works even when WHATSAPP_AUTO_INIT=false
 * disables every automatic init path (boot + on-demand). Returns 200 immediately
 * and initializes in the background; the SSE channel reports ready/QR.
 */
router.post('/initialize', authorize(FINANCE_ROLES), (_req: Request, res: Response): void => {
  try {
    log.info('Manual WhatsApp initialization requested');
    res.json({
      success: true,
      message: 'WhatsApp initialization started',
      timestamp: Date.now(),
      action: 'initialize_requested'
    });

    setImmediate(async () => {
      try {
        await whatsapp.initialize();
        log.info('Manual WhatsApp initialization completed successfully');
      } catch (error) {
        log.error('Manual WhatsApp initialization failed:', (error as Error).message);
      }
    });
  } catch (error) {
    log.error('Error handling manual WhatsApp initialization request:', error);
    ErrorResponses.internalError(res, 'Failed to process initialization request', error as Error);
  }
});


export default router;
