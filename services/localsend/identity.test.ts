// @vitest-environment node
/**
 * Tests for the server's LocalSend identity.
 *
 * LocalSend 1.18 receivers end the TLS handshake of a sender that presents no client certificate,
 * and take the SHA-256 of the one they are shown as that sender's fingerprint. This service sent
 * none, so on 2026-10-10 every send to an updated phone failed as
 * `ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED`. What is pinned here:
 *   1. the certificate we generate is one a strict parser accepts (v3, self-signed, in date);
 *   2. the fingerprint is that certificate's hash in the form LocalSend uses;
 *   3. the identity survives a restart, and a file that cannot be used or written costs the
 *      stable identity, never the ability to send;
 *   4. a TLS server that demands a client certificate gets this one.
 */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { TLSSocket } from 'tls';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { generateIdentity, loadOrCreateIdentity } = await import('./identity.js');
const { log } = await import('../../utils/logger.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localsend-identity-'));
let n = 0;
const freshFile = (): string => path.join(dir, `identity-${n++}.pem`);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('generateIdentity', () => {
  const identity = generateIdentity();
  const cert = new crypto.X509Certificate(identity.certPem);

  it('makes the certificate LocalSend makes for itself', () => {
    expect(cert.subject).toBe('CN=LocalSend User');
    expect(cert.issuer).toBe('CN=LocalSend User');
    expect(cert.publicKey.asymmetricKeyType).toBe('rsa');
    expect(cert.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(crypto.createPrivateKey(identity.keyPem))).toBe(true);
  });

  it('is an X.509 v3 certificate, which the receiver’s verifier insists on', () => {
    // Certificate SEQUENCE (4-byte header) → TBSCertificate SEQUENCE (4) → [0] { INTEGER 2 }.
    expect(cert.raw.subarray(8, 13).toString('hex')).toBe('a003020102');
  });

  it('is valid whatever the receiver’s clock says, and never runs out', () => {
    expect(Date.parse(cert.validFrom)).toBeLessThan(Date.parse('2000-01-01'));
    expect(Date.parse(cert.validTo)).toBeGreaterThan(Date.parse('2500-01-01'));
  });

  it('takes its fingerprint from the certificate: uppercase hex SHA-256 of the DER', () => {
    expect(identity.fingerprint).toMatch(/^[0-9A-F]{64}$/);
    expect(identity.fingerprint).toBe(cert.fingerprint256.replace(/:/g, ''));
  });

  it('is a different device every time it is generated', () => {
    expect(generateIdentity().fingerprint).not.toBe(identity.fingerprint);
  });
});

describe('loadOrCreateIdentity', () => {
  it('creates the file on the first run and is the same device on the next', () => {
    const file = freshFile();
    const first = loadOrCreateIdentity(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(loadOrCreateIdentity(file)).toEqual(first);
  });

  it('creates the folder the file lives in', () => {
    const file = path.join(dir, 'not', 'there', 'yet', 'identity.pem');
    loadOrCreateIdentity(file);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('reads a file with the key ahead of the certificate', () => {
    const file = freshFile();
    const identity = generateIdentity();
    fs.writeFileSync(file, identity.keyPem + identity.certPem);
    expect(loadOrCreateIdentity(file).fingerprint).toBe(identity.fingerprint);
  });

  it('replaces a file that is not an identity', () => {
    const file = freshFile();
    fs.writeFileSync(file, 'not a certificate');
    const identity = loadOrCreateIdentity(file);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(loadOrCreateIdentity(file)).toEqual(identity);
  });

  it('replaces a certificate that came with someone else’s key', () => {
    const file = freshFile();
    const theirs = generateIdentity();
    fs.writeFileSync(file, theirs.certPem + generateIdentity().keyPem);
    const identity = loadOrCreateIdentity(file);
    expect(identity.fingerprint).not.toBe(theirs.fingerprint);
    expect(loadOrCreateIdentity(file)).toEqual(identity);
  });

  it('replaces a certificate that is out of date', () => {
    const file = freshFile();
    const stored = loadOrCreateIdentity(file);
    vi.useFakeTimers({ now: new Date('1970-06-01') }); // before the certificate begins
    expect(loadOrCreateIdentity(file).fingerprint).not.toBe(stored.fingerprint);
  });

  it('still hands back an identity when the file cannot be written', () => {
    const file = freshFile();
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
    });
    expect(loadOrCreateIdentity(file).fingerprint).toMatch(/^[0-9A-F]{64}$/);
    expect(fs.existsSync(file)).toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('leaves alone a file it could not open', () => {
    const folder = freshFile();
    fs.mkdirSync(folder); // reading a folder fails with something other than "not found"
    expect(loadOrCreateIdentity(folder).fingerprint).toMatch(/^[0-9A-F]{64}$/);
    expect(fs.statSync(folder).isDirectory()).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();
  });
});

describe('as a TLS client certificate', () => {
  const sender = generateIdentity();
  const receiver = generateIdentity();

  /** A server that, like LocalSend 1.18, completes no handshake without a client certificate. */
  const server = https.createServer(
    {
      key: receiver.keyPem,
      cert: receiver.certPem,
      requestCert: true,
      rejectUnauthorized: true,
      ca: [sender.certPem],
      minVersion: 'TLSv1.3',
    },
    (req, res) => {
      const peer = (req.socket as TLSSocket).getPeerX509Certificate();
      res.end(peer ? crypto.createHash('sha256').update(peer.raw).digest('hex').toUpperCase() : '');
    }
  );
  const listening = new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  afterAll(() => {
    server.close();
  });

  const get = async (agent: https.Agent): Promise<string> => {
    const port = await listening;
    return new Promise((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port, agent }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk));
          res.on('end', () => resolve(body));
          res.on('error', reject);
        })
        .on('error', reject);
    });
  };

  it('is presented, and the server sees the fingerprint we announce', async () => {
    const agent = new https.Agent({ rejectUnauthorized: false, cert: sender.certPem, key: sender.keyPem });
    await expect(get(agent)).resolves.toBe(sender.fingerprint);
  });

  it('is what the old agent lacked: without it the connection is refused', async () => {
    await expect(get(new https.Agent({ rejectUnauthorized: false }))).rejects.toThrow();
  });
});
