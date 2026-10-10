// @vitest-environment node
/**
 * Tests for the `register` listener, driven the way a LocalSend device drives it: over real TLS
 * on a loopback port.
 *
 * A device on LocalSend 1.18+ answers our announcement only by calling `register` here, and it
 * completes the handshake only with the certificate whose hash we announced. What is pinned:
 *   1. the listener answers with our identity, and in the shape the protocol's response has;
 *   2. a caller is known by the certificate it proved, not by the fingerprint it claims;
 *   3. it answers discovery and refuses files;
 *   4. a caller that keeps knocking is cut off before its handshake.
 */
import https from 'https';
import net from 'net';
import type { TLSSocket } from 'tls';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { fingerprintOf, generateIdentity } = await import('./identity.js');
const { openRegisterListener, PeerLimiter } = await import('./register-listener.js');
const { log } = await import('../../utils/logger.js');
type Identity = ReturnType<typeof generateIdentity>;
type Registration = import('./register-listener.js').Registration;
type RegisterListener = import('./register-listener.js').RegisterListener;

const server = generateIdentity();
const phone = generateIdentity();

const SELF = {
  alias: 'Clinic Server',
  version: '2.0',
  deviceModel: 'Server',
  deviceType: 'server',
  fingerprint: server.fingerprint,
  download: false,
};

/** What a 1.18 device posts (its `RegisterDtoV2`). */
const phoneBody = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    alias: 'Galaxy Phone',
    version: '2.1',
    deviceModel: 'Samsung',
    deviceType: 'mobile',
    fingerprint: phone.fingerprint,
    port: 53317,
    protocol: 'https',
    download: false,
    ...over,
  });

interface Answer {
  status: number;
  body: unknown;
  /** The fingerprint of the certificate the listener answered with. */
  servedBy: string;
}

/** One request on a connection of its own, as the device `identity` (or as one with no certificate). */
function call(
  port: number,
  method: string,
  path: string,
  options: { body?: string; identity?: Identity; chunked?: boolean } = {}
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        agent: false,
        rejectUnauthorized: false,
        ...(options.identity ? { cert: options.identity.certPem, key: options.identity.keyPem } : {}),
        headers:
          options.body === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                ...(options.chunked ? {} : { 'Content-Length': Buffer.byteLength(options.body) }),
              },
      },
      (res) => {
        const certificate = (res.socket as TLSSocket).getPeerX509Certificate();
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: text ? JSON.parse(text) : null,
            servedBy: certificate ? fingerprintOf(certificate.raw) : '',
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

/** Resolves with the error code of a plain TCP connect, or `null` when something accepted it. */
const connectError = (port: number): Promise<string | null> =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(null);
    });
    socket.once('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'ERROR'));
  });

const registered: Registration[] = [];
let listener: RegisterListener;
let port = 0;

beforeAll(async () => {
  listener = openRegisterListener({
    identity: server,
    port: 0,
    host: '127.0.0.1',
    selfInfo: () => SELF,
    onRegister: (registration) => registered.push(registration),
    // Not what is under test here: the last describe has a listener with limits of its own.
    limits: { windowMs: 60_000, perAddress: 10_000, total: 10_000 },
  });
  port = (await listener.listening) ?? 0;
});
afterEach(() => {
  registered.length = 0;
  vi.clearAllMocks();
});
afterAll(() => listener.close());

describe('register', () => {
  it('answers with the certificate whose hash we announce, which is what a 1.18 device pins', async () => {
    const answer = await call(port, 'POST', '/api/localsend/v2/register', { body: phoneBody(), identity: phone });
    expect(answer.status).toBe(200);
    expect(answer.servedBy).toBe(server.fingerprint);
  });

  it('answers with the protocol’s response: who we are, and no port or protocol', async () => {
    const answer = await call(port, 'POST', '/api/localsend/v2/register', { body: phoneBody(), identity: phone });
    expect(answer.body).toEqual(SELF);
  });

  it('hands over the device, at the address it called from and the port it says it listens on', async () => {
    await call(port, 'POST', '/api/localsend/v2/register', { body: phoneBody({ port: 40000 }), identity: phone });
    expect(registered).toEqual([
      {
        fingerprint: phone.fingerprint,
        alias: 'Galaxy Phone',
        deviceModel: 'Samsung',
        deviceType: 'mobile',
        ip: '127.0.0.1',
        port: 40000,
        protocol: 'https',
      },
    ]);
  });

  it('knows a caller by the certificate it proved, whatever fingerprint its body claims', async () => {
    const impostor = generateIdentity();
    await call(port, 'POST', '/api/localsend/v2/register', {
      body: phoneBody({ fingerprint: phone.fingerprint }),
      identity: impostor,
    });
    expect(registered).toHaveLength(1);
    expect(registered[0].fingerprint).toBe(impostor.fingerprint);
  });

  it('takes the claimed fingerprint of a caller with no certificate, as apps up to 1.17 have none', async () => {
    const answer = await call(port, 'POST', '/api/localsend/v2/register', {
      body: phoneBody({ fingerprint: 'AN-OLD-APP', deviceModel: null, deviceType: undefined }),
    });
    expect(answer.status).toBe(200);
    expect(registered).toEqual([expect.objectContaining({ fingerprint: 'AN-OLD-APP', alias: 'Galaxy Phone' })]);
    expect(registered[0].deviceModel).toBeUndefined();
  });

  it('refuses a body that is not a register, and lists nobody', async () => {
    for (const body of ['not json', '[]', JSON.stringify({ alias: 'No fingerprint' }), phoneBody({ port: 'x' })]) {
      const answer = await call(port, 'POST', '/api/localsend/v2/register', { body, identity: phone });
      expect(answer.status).toBe(400);
    }
    expect(registered).toEqual([]);
  });

  it('refuses a body larger than a register can be, by its declared length or by its bytes', async () => {
    // The listener answers 413 and hangs up without reading the rest. A caller still sending
    // can find the connection reset before it has read that answer, so either is a refusal.
    const refusal = (attempt: Promise<Answer>): Promise<number | 'reset'> =>
      attempt.then(
        (answer) => answer.status,
        () => 'reset'
      );
    const body = phoneBody({ padding: 'y'.repeat(9000) });

    expect([413, 'reset']).toContain(await refusal(call(port, 'POST', '/api/localsend/v2/register', { body, identity: phone })));
    expect([413, 'reset']).toContain(
      await refusal(call(port, 'POST', '/api/localsend/v2/register', { body, identity: phone, chunked: true }))
    );
    expect(registered).toEqual([]);
    // And it is still there for the next caller.
    expect((await call(port, 'GET', '/api/localsend/v2/info')).status).toBe(200);
  });
});

describe('the rest of the protocol', () => {
  it('answers info on v2, and on the v1 route apps up to 1.17 probe', async () => {
    for (const path of ['/api/localsend/v2/info', '/api/localsend/v1/info', '/api/localsend/v2/info?fingerprint=abc']) {
      const answer = await call(port, 'GET', path);
      expect(answer).toMatchObject({ status: 200, body: SELF });
    }
  });

  it('declines files: this server sends and does not receive', async () => {
    const answer = await call(port, 'POST', '/api/localsend/v2/prepare-upload', {
      body: JSON.stringify({ info: {}, files: { a: { id: 'a', fileName: 'photo.jpg', size: 1, fileType: 'image/jpeg' } } }),
      identity: phone,
    });
    expect(answer.status).toBe(403);
  });

  it('has nothing else', async () => {
    expect((await call(port, 'POST', '/api/localsend/v2/upload?sessionId=s&fileId=a&token=t', { identity: phone })).status).toBe(404);
    expect((await call(port, 'GET', '/', { identity: phone })).status).toBe(404);
    expect((await call(port, 'GET', '/api/localsend/v2/register', { identity: phone })).status).toBe(404);
  });
});

describe('PeerLimiter', () => {
  it('gives each address its count, and all of them the total, per window', () => {
    let now = 1_000_000;
    const limiter = new PeerLimiter({ windowMs: 10_000, perAddress: 2, total: 3 }, () => now);

    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false); // its own count is spent
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('c')).toBe(false); // the total is spent, though c asked for nothing yet

    now += 10_000;
    expect(limiter.allow('a')).toBe(true); // a new window
    expect(limiter.allow('c')).toBe(true);
  });
});

describe('a caller that keeps knocking', () => {
  it('is told so, and then is dropped as it connects', async () => {
    // Each call is two counts: its connection and its request.
    const strict = openRegisterListener({
      identity: server,
      port: 0,
      host: '127.0.0.1',
      selfInfo: () => SELF,
      onRegister: () => undefined,
      limits: { windowMs: 60_000, perAddress: 3, total: 100 },
    });
    try {
      const strictPort = (await strict.listening) ?? 0;
      expect((await call(strictPort, 'GET', '/api/localsend/v2/info')).status).toBe(200);
      expect((await call(strictPort, 'GET', '/api/localsend/v2/info')).status).toBe(429);
      await expect(call(strictPort, 'GET', '/api/localsend/v2/info')).rejects.toThrow();
    } finally {
      await strict.close();
    }
  });
});

describe('opening and closing', () => {
  it('reports a port it could not have, without throwing, and can still be closed', async () => {
    const second = openRegisterListener({
      identity: server,
      port,
      host: '127.0.0.1',
      selfInfo: () => SELF,
      onRegister: () => undefined,
    });
    expect(await second.listening).toBeNull();
    expect(log.warn).toHaveBeenCalledOnce();
    await expect(second.close()).resolves.toBeUndefined();
    // The first one is untouched.
    expect((await call(port, 'GET', '/api/localsend/v2/info')).status).toBe(200);
  });

  it('leaves the port closed once closed, with the connections that were open', async () => {
    const brief = openRegisterListener({
      identity: server,
      port: 0,
      host: '127.0.0.1',
      selfInfo: () => SELF,
      onRegister: () => undefined,
    });
    const briefPort = (await brief.listening) ?? 0;
    expect(await connectError(briefPort)).toBeNull();

    // A caller that connected and never began its handshake: the kind of connection the HTTP
    // server does not know about, and that held the port open until it timed out.
    const idle = net.connect(briefPort, '127.0.0.1');
    idle.on('error', () => undefined);
    await new Promise((resolve) => idle.once('connect', resolve));

    await brief.close();
    expect(await connectError(briefPort)).toBe('ECONNREFUSED');
    idle.destroy();
  });
});
