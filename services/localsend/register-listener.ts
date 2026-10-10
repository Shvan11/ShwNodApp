/**
 * The LocalSend `register` listener: the one thing a device on LocalSend 1.18+ asks of whoever
 * announces to it.
 *
 * Such a device answers an announcement in one way, an HTTPS `POST /api/localsend/v2/register`
 * to the announcer, and puts the announcer in its own device list only once that request has
 * succeeded. Nothing comes back over UDP. With nothing listening here, a 1.18 phone entered the
 * picker only when Rescan asked every address on the subnet, and the server never appeared on
 * the phone, which is where its owner marks a device a favourite (a favourite's files are
 * accepted without a tap).
 *
 * It answers discovery and nothing else: `register`, and the `info` older apps probe with. This
 * server sends files and does not receive them (owner's decision, 2026-10-10), so
 * `prepare-upload` is answered 403, which a sender shows as "declined".
 *
 * Who a caller is: over TLS, the certificate it proved it holds. The hash of that certificate is
 * its fingerprint whatever its body claims (the protocol has the body's ignored in HTTPS mode),
 * which is also how LocalSend's own receiver knows a sender. Apps up to 1.17 present no
 * certificate; theirs is taken from the body, as it always was from their announcements.
 *
 * The port is open to every device on the LAN, and a TLS handshake is about 2 ms of the event
 * loop the whole app runs on (measured on the clinic's server: 200 at once held it for 0.4 s).
 * So connections and requests are counted per address and overall, and one over the count is
 * dropped as it connects, before its handshake. The service opens this listener only while the
 * picker is in use (`wake` in localsend.service.ts).
 */
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import type { TLSSocket } from 'tls';
import { z } from 'zod';
import { log } from '../../utils/logger.js';
import { fingerprintOf, type LocalSendIdentity } from './identity.js';

/** What `register` and `info` answer with: our announcement without its transport fields. */
export interface PeerInfo {
  alias: string;
  version: string;
  deviceModel: string;
  deviceType: string;
  fingerprint: string;
  download: boolean;
}

/** A device that introduced itself. */
export interface Registration {
  /** The hash of the certificate the device proved it holds; with none presented, its own claim. */
  fingerprint: string;
  alias: string;
  deviceModel?: string;
  deviceType?: string;
  /** Where the request came from. */
  ip: string;
  /** Where the device says it listens. */
  port?: number;
  protocol?: 'http' | 'https';
}

export interface Limits {
  windowMs: number;
  /** Connections plus requests one address may make in a window. */
  perAddress: number;
  /** The same, for all addresses together. */
  total: number;
}

/**
 * A device answers each of our announcements (one every 5 s) with one request, on a connection
 * it kept or a new one: four in a window at the most. The total is what bounds the handshakes a
 * crowd of addresses can cost: 200 in ten seconds is under 5 % of the event loop.
 */
export const DEFAULT_LIMITS: Limits = { windowMs: 10_000, perAddress: 20, total: 200 };

/** Idle connections held open, however many devices keep theirs. */
const MAX_CONNECTIONS = 128;
/** A `register` body is some 200 bytes. */
const MAX_BODY_BYTES = 8 * 1024;
/** A `prepare-upload` lists the files it offers, some 200 bytes each. We read it only to decline it. */
const MAX_DECLINED_BODY_BYTES = 1024 * 1024;
// A peer that connects and says nothing, or stops halfway through its request.
const HANDSHAKE_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
// Longer than the gap between two announcements, so a device answers the next one on the
// connection it already has: a fourteenth of the work of a new handshake.
const KEEP_ALIVE_MS = 30_000;

/**
 * Counts what each address, and all of them together, asked for in the current window.
 * Fixed windows: the count restarts every `windowMs`, so a burst can straddle two windows and
 * reach twice the limit, which is still a bound. Nothing is remembered about an address once
 * the total is spent, so the table never holds more than `total` entries.
 */
export class PeerLimiter {
  private windowStart = 0;
  private total = 0;
  private readonly perAddress = new Map<string, number>();

  constructor(
    private readonly limits: Limits,
    private readonly now: () => number = Date.now
  ) {}

  allow(address: string): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.limits.windowMs) {
      this.windowStart = now;
      this.total = 0;
      this.perAddress.clear();
    }
    if (this.total >= this.limits.total) return false;
    const count = this.perAddress.get(address) ?? 0;
    if (count >= this.limits.perAddress) return false;
    this.perAddress.set(address, count + 1);
    this.total++;
    return true;
  }
}

/**
 * The `register` body. A 1.18 device sends all of it; older apps and other clients leave the
 * optional fields out or send them as null. Whatever else the body carries is not read.
 */
const registerBody = z.object({
  alias: z.string().min(1).max(128),
  fingerprint: z.string().min(1).max(128),
  deviceModel: z.string().max(128).nullish(),
  deviceType: z.string().max(32).nullish(),
  port: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['http', 'https']).optional(),
});

class BodyTooLarge extends Error {}

/** The request's body, up to `limit` bytes. Rejects when it is larger or never completes. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
        return;
      }
      // Stop keeping it. The reply that follows closes the connection it is arriving on.
      req.removeAllListeners('data');
      reject(new BodyTooLarge());
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('close', () => reject(new Error('the request was closed before its body ended')));
  });
}

/**
 * Take the request's body off the wire without keeping it, up to `limit` bytes. Closing a
 * connection that still has unread bytes on it resets it, and the caller can lose the answer it
 * was sent: a phone that tried to send a file here would see a network error where it should
 * see "declined".
 */
function discardBody(req: IncomingMessage, limit: number): Promise<void> {
  return new Promise((resolve) => {
    let size = 0;
    const done = (): void => {
      req.removeListener('data', onData);
      resolve();
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) done();
    };
    req.on('data', onData);
    req.once('end', done);
    req.once('error', done);
    req.once('close', done);
  });
}

/**
 * Answer in JSON. `close` ends the connection with the response: for a caller we have no more
 * to say to, and so that a body we did not read is never waited for.
 */
function reply(res: ServerResponse, status: number, body: unknown, close = false): void {
  if (res.socket?.destroyed) return; // the caller left while we were reading
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    ...(close ? { Connection: 'close' } : {}),
  });
  res.end(json);
}

export interface RegisterListenerOptions {
  /** The certificate we answer with. A device pins it to the fingerprint we announced. */
  identity: LocalSendIdentity;
  port: number;
  /**
   * The address to bind. Every IPv4 interface by default: an announcement leaves by each of
   * them, and its answer comes back to the one it left by.
   */
  host?: string;
  /** What we tell a caller about ourselves. */
  selfInfo: () => PeerInfo;
  /** A device introduced itself. */
  onRegister: (registration: Registration) => void;
  limits?: Limits;
}

export interface RegisterListener {
  /** The port it is bound to, or `null` when it could not be bound. Never rejects. */
  readonly listening: Promise<number | null>;
  /** Stop listening and drop the connections that are open. */
  close(): Promise<void>;
}

/**
 * Open the listener. A port that cannot be bound (LocalSend's own app running on this machine
 * holds the same one) is logged and leaves discovery as it was without a listener.
 */
export function openRegisterListener(options: RegisterListenerOptions): RegisterListener {
  const limiter = new PeerLimiter(options.limits ?? DEFAULT_LIMITS);

  async function register(req: IncomingMessage, res: ServerResponse, ip: string): Promise<void> {
    let raw: Buffer;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      // Anything but an oversized body is a caller that went away: there is no one to answer.
      if (err instanceof BodyTooLarge) reply(res, 413, { message: 'Body too large' }, true);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      json = undefined;
    }
    const body = registerBody.safeParse(json);
    if (!body.success) {
      reply(res, 400, { message: 'Invalid body' }, true);
      return;
    }

    const certificate = (req.socket as TLSSocket).getPeerX509Certificate();
    options.onRegister({
      fingerprint: certificate ? fingerprintOf(certificate.raw) : body.data.fingerprint,
      alias: body.data.alias,
      deviceModel: body.data.deviceModel ?? undefined,
      deviceType: body.data.deviceType ?? undefined,
      ip,
      port: body.data.port,
      protocol: body.data.protocol,
    });
    reply(res, 200, options.selfInfo());
  }

  const server = https.createServer(
    {
      cert: options.identity.certPem,
      key: options.identity.keyPem,
      // Ask for the caller's certificate and take whichever it has: they are all self-signed,
      // and the handshake still proves the caller holds the key of the one it shows.
      requestCert: true,
      rejectUnauthorized: false,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      headersTimeout: HEADERS_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      keepAliveTimeout: KEEP_ALIVE_MS,
    },
    (req, res) => {
      try {
        const ip = req.socket.remoteAddress;
        if (!ip || !limiter.allow(ip)) {
          reply(res, 429, { message: 'Too many requests' }, true);
          return;
        }
        switch (`${req.method} ${(req.url ?? '').split('?', 1)[0]}`) {
          case 'POST /api/localsend/v2/register':
            void register(req, res, ip).catch(() => req.socket.destroy());
            return;
          // On v1 as well: that is the route apps up to 1.17 ask an address they do not know.
          case 'GET /api/localsend/v1/info':
          case 'GET /api/localsend/v2/info':
            reply(res, 200, options.selfInfo());
            return;
          case 'POST /api/localsend/v2/prepare-upload':
            void discardBody(req, MAX_DECLINED_BODY_BYTES).then(() =>
              reply(res, 403, { message: 'This device does not receive files' }, true)
            );
            return;
          default:
            reply(res, 404, { message: 'Not found' }, true);
        }
      } catch {
        req.socket.destroy();
      }
    }
  );
  server.maxConnections = MAX_CONNECTIONS;

  // Counted as it connects, on the raw socket: the handshake is the expensive part, and a
  // connection dropped here never starts one.
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    if (!limiter.allow(socket.remoteAddress ?? '')) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  const listening = new Promise<number | null>((resolve) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      log.warn('[LocalSend] Register listener failed — devices on LocalSend 1.18+ will only appear after Rescan', {
        port: options.port,
        code: err.code,
        error: err.message,
      });
      resolve(null);
    });
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  return {
    listening,
    close: () =>
      new Promise<void>((resolve) => {
        // Calls back with an error when the port was never bound; closed is closed either way.
        server.close(() => resolve());
        // Every connection, from the socket up. `closeAllConnections()` knows only the ones
        // that finished their handshake, and one that had not held the port (and the app's
        // shutdown) until its handshake timed out.
        for (const socket of sockets) socket.destroy();
      }),
  };
}
