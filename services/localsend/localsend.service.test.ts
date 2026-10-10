// @vitest-environment node
/**
 * Tests for the LocalSend sender against a receiver that behaves like LocalSend 1.18.
 *
 * Since 1.18 a receiver completes no TLS handshake without a client certificate, and it takes the
 * hash of that certificate as the sender's fingerprint. The sender presented none and announced a
 * random UUID, so every send to an updated phone failed in the handshake, and the user was asked
 * "Is LocalSend open on it?". The receiver below enforces what 1.18 enforces; the tests drive the
 * real service through it (probe, prepare-upload, upload) over real sockets.
 */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import type { IncomingMessage } from 'http';
import type { AddressInfo } from 'net';
import type { TLSSocket } from 'tls';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localsend-service-'));
const photo = path.join(dir, 'photo.jpg');
const photoBytes = crypto.randomBytes(300_000);
fs.writeFileSync(photo, photoBytes);

/** `port` is the port the service probes; each test points it at its own listener. */
const localsendConfig = { enabled: true, port: 0, alias: 'Clinic Server', multicast: '224.0.0.167' };

vi.mock('../../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config/config.js', () => ({ default: { localsend: localsendConfig } }));
vi.mock('../files/share-ref.js', () => ({
  resolveShareRef: async () => ({ abs: photo, size: photoBytes.length, name: 'photo.jpg', fileType: 'image/jpeg' }),
}));
// The service keeps its identity under the app's `data/`; a test must never touch that file.
vi.mock('./identity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./identity.js')>()),
  IDENTITY_FILE: path.join(dir, 'identity.pem'),
}));

const { generateIdentity, loadOrCreateIdentity, IDENTITY_FILE } = await import('./identity.js');
const { localsendService } = await import('./localsend.service.js');
const { log } = await import('../../utils/logger.js');

/** The identity the service will load: the receiver has to know the certificate to demand it. */
const sender = loadOrCreateIdentity(IDENTITY_FILE);
const phone = generateIdentity();

const fingerprintOf = (req: IncomingMessage): string => {
  const cert = (req.socket as TLSSocket).getPeerX509Certificate();
  return cert ? crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase() : '';
};
const bodyOf = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

/** What the receiver was shown. */
const seen: { presented: string[]; claimed?: string; fileName?: string; upload?: Buffer } = { presented: [] };

/** The three v2 endpoints a send touches, behind a handshake that requires our certificate. */
const receiver = https.createServer(
  {
    key: phone.keyPem,
    cert: phone.certPem,
    requestCert: true,
    rejectUnauthorized: true,
    ca: [sender.certPem],
    minVersion: 'TLSv1.3',
  },
  (req, res) => {
    void (async () => {
      seen.presented.push(fingerprintOf(req));
      const url = new URL(req.url ?? '/', 'https://phone');
      const json = (body: unknown): void => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };

      if (url.pathname === '/api/localsend/v2/info') {
        // As 1.18 answers: no port and no protocol in the body.
        json({ alias: 'Phone', version: '2.2', deviceModel: 'Test', deviceType: 'mobile', fingerprint: phone.fingerprint, download: false });
      } else if (url.pathname === '/api/localsend/v2/prepare-upload') {
        const request = JSON.parse((await bodyOf(req)).toString()) as {
          info: { fingerprint: string };
          files: Record<string, { fileName: string }>;
        };
        seen.claimed = request.info.fingerprint;
        seen.fileName = request.files['0'].fileName;
        json({ sessionId: 'session-1', files: { '0': 'token-0' } });
      } else if (url.pathname === '/api/localsend/v2/upload' && url.searchParams.get('token') === 'token-0') {
        seen.upload = await bodyOf(req);
        res.end();
      } else {
        res.statusCode = 404;
        res.end();
      }
    })();
  }
);

/**
 * A listener that is not speaking TLS at all, e.g. a device whose encryption was switched off.
 * It answers the ClientHello and leaves the closing to the client: closing first would race a
 * reset against the bytes the client is meant to choke on.
 */
const plain = net.createServer((socket) => {
  socket.on('error', () => undefined);
  socket.once('data', () => socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'));
});

/** The phone has its own loopback address, so a scan from "our" 127.0.0.1 has a neighbour to find. */
const PHONE_IP = '127.0.0.9';

const listen = (server: net.Server, host: string): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });

let receiverPort = 0;
let plainPort = 0;
beforeAll(async () => {
  receiverPort = await listen(receiver, PHONE_IP);
  plainPort = await listen(plain, '127.0.0.1');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await localsendService.gracefulShutdown();
  receiver.close();
  plain.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Poll a transfer the way the modal does, until it settles. */
async function settled(id: string): Promise<NonNullable<ReturnType<typeof localsendService.getTransfer>>> {
  for (let i = 0; i < 100; i++) {
    const status = localsendService.getTransfer(id);
    if (status && !['pending', 'sending'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the transfer never settled');
}

describe('sending to a receiver that requires a client certificate', () => {
  it('the receiver really does turn away a sender with none', async () => {
    const withoutCertificate = new Promise((resolve, reject) => {
      https
        .get({ host: PHONE_IP, port: receiverPort, path: '/api/localsend/v2/info', rejectUnauthorized: false }, resolve)
        .on('error', reject);
    });
    await expect(withoutCertificate).rejects.toThrow();
  });

  it('adds the device by IP, on the port it answered on', async () => {
    localsendConfig.port = receiverPort;
    const device = await localsendService.probe(PHONE_IP);
    expect(device).toMatchObject({ alias: 'Phone', fingerprint: phone.fingerprint, port: receiverPort, protocol: 'https' });
  });

  it('sends the file, as the device its certificate says it is', async () => {
    localsendConfig.port = receiverPort;
    await localsendService.probe(PHONE_IP);
    const id = await localsendService.send(phone.fingerprint, [{ source: 'patient-file', personId: 1, ref: 'photo.jpg' }]);

    expect(await settled(id)).toMatchObject({ status: 'completed', deviceAlias: 'Phone' });
    expect(seen.fileName).toBe('photo.jpg');
    expect(seen.upload?.equals(photoBytes)).toBe(true);
    // Every request arrived over a handshake that carried our certificate…
    expect(new Set(seen.presented)).toEqual(new Set([sender.fingerprint]));
    // …and the fingerprint we claim is that certificate's, not a value of our own choosing.
    expect(seen.claimed).toBe(sender.fingerprint);
  });
});

describe('Rescan', () => {
  it('finds a device that never announced itself, by asking the addresses on our subnet', async () => {
    // Our only "interface" is 127.0.0.1, so the scan covers 127.0.0.2-254 and nothing on the real LAN.
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ address: '127.0.0.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '127.0.0.1/24' }],
    });
    localsendConfig.port = receiverPort;
    // Six minutes on, whatever the tests above added has aged out of the picker.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60 * 1000 });
    expect(localsendService.getDevices()).toEqual([]);

    localsendService.scan();

    await vi.waitFor(() => expect(localsendService.getDevices()).toEqual([expect.objectContaining({ alias: 'Phone', ip: PHONE_IP })]), {
      timeout: 8000,
    });
    // The other 252 addresses refused; wait for the scan to be over before the servers close.
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('[LocalSend] Subnet scan finished', { addresses: 253, found: 1 }), {
      timeout: 8000,
    });
  }, 20_000);
});

describe('a device that answers but will not complete the secure connection', () => {
  it('is reported as that, not as a device that could not be reached', async () => {
    localsendConfig.port = plainPort;
    const failure = await localsendService.probe('127.0.0.1').then(
      () => null,
      (err: Error) => err.message
    );
    expect(failure).toMatch(/^The device at 127\.0\.0\.1 answered but refused the secure connection \((ERR_SSL_\w+|EPROTO)\)/);
    expect(failure).not.toContain('Is LocalSend open');
  });
});
