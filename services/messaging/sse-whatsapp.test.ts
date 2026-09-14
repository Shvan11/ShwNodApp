/**
 * Tests for the per-stream authorization filter on the WhatsApp SSE channel.
 *
 * The pairing QR links a device to the clinic's WhatsApp account, so `GET
 * /api/wa/qr` is FINANCE_ROLES and `/api/wa/initial-state` returns `qr: null`
 * to everyone else. This channel used to fan the same QR to EVERY authenticated
 * stream with no filter of any kind, which made it the way around both gates —
 * a `clinical` session that is 403'd on `/qr` still received a scannable data
 * URL in an unsolicited push frame.
 *
 * The fix cannot be `authorize()` on the route: six of the seven wire events
 * drive the send screens and the per-patient send gate, and sending is
 * CLINICAL_ROLES. So the guarantee under test is narrower and easy to regress —
 * exactly one event, exactly one field, filtered per stream:
 *   1. `whatsapp_qr_updated` reaches a non-finance stream with `qr: null`;
 *   2. ...but still carries `clientReady`, which is app-wide state;
 *   3. the finance stream gets the real QR from the same emit;
 *   4. every OTHER event goes to every stream verbatim.
 */
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./messageState.js', () => ({
  default: {
    registerQRViewer: vi.fn().mockResolvedValue({ activeViewers: 1 }),
    unregisterQRViewer: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { InternalEmitterEvents } = await import('./websocket-events.js');
const { createWhatsappSseRouter, teardownWhatsappSseBroadcaster } = await import(
  './sse-whatsapp.js'
);

interface FakeStream {
  frames: string[];
  events: () => Array<{ event: string; data: Record<string, unknown> }>;
}

/**
 * Open one stream against the router as `role` and collect what it is written.
 *
 * The handler is pulled off the router's own stack rather than going through a
 * real HTTP server: an SSE response never ends, so a live server would leave
 * the suite holding open sockets. `openStream`/`broadcast` only ever touch the
 * `res` methods stubbed here.
 */
async function openStream(
  router: ReturnType<typeof createWhatsappSseRouter>,
  role: string | undefined
): Promise<FakeStream> {
  const layer = (router as unknown as {
    stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }>;
  }).stack.find((l) => l.route?.path === '/whatsapp');
  if (!layer?.route) throw new Error('GET /whatsapp not registered on the router');
  const handler = layer.route.stack[0].handle as (req: Request, res: Response) => Promise<void>;

  const frames: string[] = [];
  const req = {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    session: role ? { userId: 1, userRole: role } : {},
    setTimeout: () => {},
    on: () => {},
  } as unknown as Request;
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead: () => res,
    flushHeaders: () => {},
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
    setTimeout: () => {},
    end: () => {},
  } as unknown as Response & { writableEnded: boolean; destroyed: boolean };

  await handler(req, res);

  return {
    frames,
    events: () =>
      frames
        .filter((f) => f.startsWith('event: '))
        .map((f) => {
          const event = f.slice(7, f.indexOf('\n'));
          const data = f.slice(f.indexOf('data: ') + 6, f.lastIndexOf('\n\n'));
          return { event, data: JSON.parse(data) as Record<string, unknown> };
        }),
  };
}

const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';

afterEach(() => {
  teardownWhatsappSseBroadcaster();
  vi.clearAllMocks();
});

describe('whatsapp SSE — pairing-QR filter', () => {
  it('withholds the QR from a clinical stream and delivers it to finance, from one emit', async () => {
    const emitter = new EventEmitter();
    const router = createWhatsappSseRouter(emitter);

    const clinical = await openStream(router, 'clinical');
    const frontDesk = await openStream(router, 'front_desk');
    const admin = await openStream(router, 'admin');

    emitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
      qr: QR_DATA_URL,
      clientReady: false,
    });

    const [clinicalFrame] = clinical.events();
    expect(clinicalFrame.event).toBe('whatsapp_qr_updated');
    expect(clinicalFrame.data.qr).toBeNull();

    // Both halves of FINANCE_ROLES, not just admin — `mayPair` is a membership
    // test with no admin bypass, so front_desk has to be checked on its own.
    for (const finance of [frontDesk, admin]) {
      const [frame] = finance.events();
      expect(frame.event).toBe('whatsapp_qr_updated');
      expect(frame.data.qr).toBe(QR_DATA_URL);
    }
  });

  it('still tells a non-pairing stream that the client is not ready', async () => {
    const emitter = new EventEmitter();
    const router = createWhatsappSseRouter(emitter);
    const clinical = await openStream(router, 'clinical');

    emitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
      qr: QR_DATA_URL,
      clientReady: false,
    });

    // Dropping the frame outright would leave the tab believing WhatsApp is
    // still linked, and SendMessage's gate reads exactly this flag.
    expect(clinical.events()[0].data.clientReady).toBe(false);
  });

  it('treats a session with no role as non-pairing', async () => {
    const emitter = new EventEmitter();
    const router = createWhatsappSseRouter(emitter);
    const roleless = await openStream(router, undefined);

    emitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
      qr: QR_DATA_URL,
      clientReady: false,
    });

    expect(roleless.events()[0].data.qr).toBeNull();
  });

  it('leaves every other wire event untouched for every role', async () => {
    const emitter = new EventEmitter();
    const router = createWhatsappSseRouter(emitter);

    const clinical = await openStream(router, 'clinical');
    const admin = await openStream(router, 'admin');

    // The six frames the send screens and the per-patient send gate live on.
    emitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, {
      clientReady: true,
      state: 'ready',
      message: 'WhatsApp client is ready!',
    });
    emitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
      messageId: 'm1',
      status: 3,
      patientName: 'Test Patient',
      phone: '9647700000000',
      appointmentId: 42,
    });
    emitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_STARTED, {
      total: 5,
      sent: 0,
      failed: 0,
      sessionId: 's1',
      date: '2026-09-08',
    });
    emitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_PROGRESS, {
      sent: 1,
      failed: 0,
      finished: false,
    });
    emitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_FINISHED, {
      finished: true,
      sent: 5,
      failed: 0,
      total: 5,
    });
    emitter.emit(InternalEmitterEvents.WHATSAPP_SEND_UNCONFIRMED, {
      date: '2026-09-08',
      sentCount: 3,
      message: 'WhatsApp stopped responding',
    });

    expect(clinical.events()).toHaveLength(6);
    expect(clinical.events()).toEqual(admin.events());
    expect(clinical.events().map((e) => e.event)).toEqual([
      'whatsapp_client_ready',
      'whatsapp_message_status',
      'whatsapp_sending_started',
      'whatsapp_sending_progress',
      'whatsapp_sending_finished',
      'whatsapp_send_unconfirmed',
    ]);
  });
});
