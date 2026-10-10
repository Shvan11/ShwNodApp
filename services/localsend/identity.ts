/**
 * This server's LocalSend identity — a self-signed certificate and its private key.
 *
 * LocalSend 1.18 (Aug 2026, protocol v2.2) moved the receiver onto its Rust core, which makes a
 * TLS CLIENT certificate mandatory: a sender that presents none is dropped during the handshake
 * with alert 116, which Node reports as `ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED`. Until then
 * the receiver never asked, so this service sent none, and on 2026-10-10 every send to an updated
 * phone began failing with a message that blamed the network.
 *
 * A device's identity in that protocol is the SHA-256 of its certificate: the receiver hashes the
 * client certificate it verified and treats THAT as the sender's fingerprint, for its favourites
 * (auto-accepted by default since 1.18) and its block list. So the fingerprint we announce and put
 * in `prepare-upload` has to be this certificate's hash, not the random per-process UUID it was.
 *
 * The identity is kept in one PEM file (certificate, then key — the layout of the official CLI's
 * `identity.pem`, so one can stand in for the other) beside the app's other runtime state. Without
 * it every restart would be a new device to every receiver. A file that is missing or unusable is
 * replaced; one that cannot be written leaves an identity that lasts for this process, because a
 * read-only install should still be able to send.
 *
 * Node can parse X.509 but has no API to create it, and the packages that do bring in over twenty
 * others for the sake of one certificate. The structure is fixed and small, so it is encoded here
 * and read back through Node's own parser before it is used. It copies what LocalSend's apps
 * generate for themselves (RSA-2048, `CN=LocalSend User`, v3 with no extensions, 1975 to 4096),
 * which is the shape every receiver is known to accept.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';

export interface LocalSendIdentity {
  /** The self-signed certificate, PEM. Presented as the TLS client certificate. */
  certPem: string;
  /** Its private key, PEM (PKCS#8). */
  keyPem: string;
  /** Uppercase-hex SHA-256 of the certificate in DER: the fingerprint receivers know us by. */
  fingerprint: string;
}

/** Lives with the app's other runtime state (`data/`); `*.pem` is gitignored. */
export const IDENTITY_FILE = path.join(process.cwd(), 'data', 'localsend-identity.pem');

// ── DER, as much of it as one certificate needs ─────────────────────────────

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts: Buffer[]): Buffer => der(0x30, ...parts);

/** A non-negative INTEGER in its shortest form (a leading zero only where the sign bit needs it). */
function derInteger(value: Buffer): Buffer {
  let bytes = value;
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}

/** sha256WithRSAEncryption (1.2.840.113549.1.1.11), with the NULL parameters RSA requires. */
const SHA256_WITH_RSA = sequence(der(0x06, Buffer.from('2a864886f70d01010b', 'hex')), der(0x05));

/** `CN=LocalSend User`. Peers identify each other by fingerprint, so the name says nothing. */
const SUBJECT = sequence(
  der(0x31, sequence(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from('LocalSend User'))))
);

/**
 * 1975 to 4096, the validity LocalSend gives its own certificates. The receiver checks it against
 * ITS clock, so a start date of "now" fails on a phone a minute behind this server, and an end
 * date would one day stop every send at once. (A date from 2050 on must be a GeneralizedTime.)
 */
const VALIDITY = sequence(der(0x17, Buffer.from('750101000000Z')), der(0x18, Buffer.from('40960101000000Z')));

/** Uppercase-hex SHA-256 of a certificate's DER, the form LocalSend fingerprints take. */
export function fingerprintOf(certDer: Buffer): string {
  return crypto.createHash('sha256').update(certDer).digest('hex').toUpperCase();
}

/** A fresh identity: a new RSA-2048 key and the certificate it signs for itself. */
export function generateIdentity(): LocalSendIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  const tbsCertificate = sequence(
    der(0xa0, derInteger(Buffer.from([2]))), // version 3: webpki, which the receiver uses, refuses v1
    derInteger(crypto.randomBytes(16)),
    SHA256_WITH_RSA,
    SUBJECT, // issuer
    VALIDITY,
    SUBJECT,
    publicKey.export({ type: 'spki', format: 'der' })
  );
  const signature = crypto.sign('sha256', tbsCertificate, privateKey);
  const certDer = sequence(tbsCertificate, SHA256_WITH_RSA, der(0x03, Buffer.from([0]), signature));

  // Read it back before it is used. A mistake in the encoding above would otherwise show up as a
  // handshake the receiver drops, which is the failure this file exists to end.
  const cert = new crypto.X509Certificate(certDer);
  if (!cert.verify(publicKey)) throw new Error('The generated LocalSend certificate does not verify');

  return {
    certPem: cert.toString(),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: fingerprintOf(certDer),
  };
}

/**
 * Read an identity out of PEM text. Throws when either block is missing, the key is not the
 * certificate's, or the certificate is outside its validity: a receiver refuses all three, and
 * that should be found here rather than on a send.
 */
function parseIdentity(pem: string): LocalSendIdentity {
  const cert = new crypto.X509Certificate(pem);
  const key = crypto.createPrivateKey(pem);
  if (!cert.checkPrivateKey(key)) throw new Error('the private key does not belong to the certificate');

  const now = Date.now();
  if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
    throw new Error(`the certificate is only valid from ${cert.validFrom} to ${cert.validTo}`);
  }

  return {
    certPem: cert.toString(),
    keyPem: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: fingerprintOf(cert.raw),
  };
}

/** Write the identity where a crash cannot leave half of it: a temp file on the same volume, renamed in. */
function saveIdentity(file: string, identity: LocalSendIdentity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    // Owner-only where the filesystem has modes; on Windows the folder's ACL is what applies.
    fs.writeFileSync(tmp, identity.certPem + identity.keyPem, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * The identity stored in `file`, created on the first run. Never fails for a reason of storage:
 * sending needs AN identity, and only keeping the same one needs the disk.
 */
export function loadOrCreateIdentity(file: string): LocalSendIdentity {
  let pem: string | null = null;
  try {
    pem = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // The file is there but would not open (a lock, a permission). Leave it alone: replacing an
      // identity that may be intact would make this server a stranger to every receiver.
      log.warn('[LocalSend] Identity file unreadable — using a temporary identity until restart', {
        file,
        error: (err as Error).message,
      });
      return generateIdentity();
    }
  }

  if (pem !== null) {
    try {
      return parseIdentity(pem);
    } catch (err) {
      log.warn('[LocalSend] Identity file unusable — replacing it; receivers will see a new device', {
        file,
        error: (err as Error).message,
      });
    }
  }

  const identity = generateIdentity();
  try {
    saveIdentity(file, identity);
    log.info('[LocalSend] Generated a new device identity', { file, fingerprint: identity.fingerprint });
  } catch (err) {
    log.warn('[LocalSend] Could not save the device identity — it will change on restart', {
      file,
      error: (err as Error).message,
    });
  }
  return identity;
}
