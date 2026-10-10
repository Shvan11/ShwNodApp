/**
 * LocalSend sender service — pushes patient files/images to LAN devices.
 *
 * The clinic server acts as a LocalSend SENDER (protocol v2): it discovers
 * receivers on the LAN, then uploads a file straight to the chosen
 * device, which shows its native Accept prompt. The browser can't do either of
 * those (no multicast, no POST to self-signed-HTTPS LAN hosts), so all of it
 * lives here and the React UI just drives it over our HTTP funnel.
 *
 * To send, the server is an HTTPS *client*. It accepts the receivers' self-signed
 * certs (`rejectUnauthorized:false`, the protocol's LAN-internal design) and
 * presents its own as the TLS client certificate, which receivers on LocalSend
 * 1.18+ refuse to talk without (see identity.ts). It receives no files.
 *
 * Discovery runs ON DEMAND. While the picker is in use (`wake`, which every read
 * of the device list calls) the server announces itself every few seconds and
 * takes the answers: UDP replies from older apps, and the HTTPS `register`
 * request that is the only answer a 1.18+ device gives (register-listener.ts).
 * `AWAKE_MS` after the picker was last read it stops announcing, closes that
 * listener and answers no one, so the rest of the day the server is not on any
 * phone's device list. Asleep it still HEARS a device that announces itself,
 * which is how one opened a moment before the picker is already in it.
 * Until 2026-10-10 it announced every 5 s around the clock with nothing
 * listening: every 1.18 phone on the LAN knocked on a closed port each time,
 * and entered the picker only when Rescan asked its address directly (see `scan`).
 *
 * Gated by `config.localsend.enabled` (off by default). To stay reliable on a
 * multi-homed host (extra/disconnected NICs, a VPN adapter), discovery binds a
 * socket to EVERY usable IPv4 interface and announces out each one, instead of
 * trusting the OS to pick a default interface — that lottery can land on a dead
 * NIC and silently swallow every announce. Interfaces appearing/disappearing are
 * reconciled on a timer. Per-interface failures (`EADDRINUSE`/`EADDRNOTAVAIL`)
 * degrade gracefully — the rest keep working and probe-by-IP always works.
 */
import dgram from 'dgram';
import net from 'net';
import os from 'os';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import { PassThrough } from 'stream';
import https from 'https';
import tls from 'tls';
import fetch from 'node-fetch';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { describeFetchError, isAbortError } from '../../utils/fetch-timeout.js';
import { resolveShareRef } from '../files/share-ref.js';
import { IDENTITY_FILE, loadOrCreateIdentity, type LocalSendIdentity } from './identity.js';
import {
  openRegisterListener,
  type PeerInfo,
  type RegisterListener,
  type Registration,
} from './register-listener.js';
import type {
  LocalSendDevice,
  SendFileRef,
  TransferStatus,
  TransferState,
} from '../../shared/contracts/localsend.contract.js';

const LOCALSEND_VERSION = '2.0';
/** The protocol's default port — the fallback for a peer whose announcement omits its own. */
const DEFAULT_PEER_PORT = 53317;
// How long a discovered/probed device stays in the picker without being re-seen.
const DEVICE_TTL_MS = 5 * 60 * 1000;
// We solicit announcements this often while awake.
const ANNOUNCE_INTERVAL_MS = 5 * 1000;
// Discovery stays awake this long after the picker was last read (opened, or Rescan).
const AWAKE_MS = 5 * 60 * 1000;
// A read that finds discovery asleep waits this long for the answers to the announcement it
// causes. A device on the LAN answers well inside a second.
const SETTLE_MS = 1200;
// Re-scan local interfaces this often so a NIC/VPN/cable coming up or down is
// picked up without a restart (one cheap os.networkInterfaces() read + diff).
const INTERFACE_SYNC_MS = 20 * 1000;
// Bounds the prepare-upload wait — the receiver's Accept dialog can sit open.
const PREPARE_TIMEOUT_MS = 90 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
// "Add by IP": one address the user typed, so it is given time to wake up.
const PROBE_TIMEOUT_MS = 8 * 1000;
// One address's share of a subnet scan. A LocalSend device answers in well under a second; this
// only bounds the wait on an address with nothing behind it.
const SCAN_TIMEOUT_MS = 3 * 1000;

/**
 * User copy for a request to a LocalSend device that never got an HTTP answer (FE-F14-7).
 * The raw rejection reads "The operation was aborted." for a timeout and
 * "request to https://…:53317/… failed, reason: connect ECONNREFUSED …" for a refusal,
 * and both reached the user verbatim; a receiver that simply never tapped *Accept* read as
 * if someone had cancelled. Every network failure in this service now comes through here,
 * which is what localsend.routes.ts's leak-rule exemption relies on.
 *
 * @param who the device's alias, or the IP being probed
 * @param waitingFor what a timeout means at this step
 */
function describeUnreachable(err: unknown, who: string, timeoutMs: number, waitingFor: string): string {
  if (isAbortError(err)) {
    return `${who} ${waitingFor} (${describeFetchError(err, timeoutMs)}). Is LocalSend open on it, and is it on the clinic network?`;
  }
  const code = (err as { code?: unknown })?.code;
  if (code === 'ECONNREFUSED') return `${who} refused the connection. Is LocalSend open on it?`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
    return `${who} can't be reached. Is it switched on and on the clinic network?`;
  }
  // A TLS failure means the device DID answer and the two sides disagreed about the secure
  // connection. "Is LocalSend open on it?" was the answer given to the 1.18 client-certificate
  // rejection, and it sent the search to the network.
  if (typeof code === 'string' && (/^ERR_(SSL|TLS)_/.test(code) || code === 'EPROTO')) {
    return `${who} answered but refused the secure connection (${code}). Try again; if it keeps failing, LocalSend on it or this server needs an update.`;
  }
  return `Couldn't reach ${who}${typeof code === 'string' ? ` (${code})` : ''}. Is LocalSend open on it?`;
}
// Finished transfers are pruned this long after they settle.
const TRANSFER_TTL_MS = 10 * 60 * 1000;

/** A receiver as we track it internally (adds freshness bookkeeping). */
interface TrackedDevice extends LocalSendDevice {
  lastSeen: number;
}

/** One file inside an in-flight transfer. */
interface TransferFile {
  name: string;
  status: 'pending' | 'sending' | 'completed' | 'failed';
  sentBytes: number;
  totalBytes: number;
  abs: string;
  fileType: string;
}

/** An in-flight (or settled) transfer. */
interface Transfer {
  id: string;
  status: TransferState;
  deviceId: string;
  deviceAlias: string;
  files: TransferFile[];
  error?: string;
  canceled: boolean;
  /** Aborts the in-flight prepare/upload request the moment cancel() is called. */
  abort: AbortController;
  /** Receiver endpoint (+ session once accepted), for the best-effort protocol cancel. */
  remote?: { base: string; agent?: https.Agent; sessionId?: string };
  settledAt?: number;
}

/** The LocalSend `register`/`info` announcement payload shape. */
interface AnnouncePayload {
  alias?: string;
  version?: string;
  deviceModel?: string;
  deviceType?: string;
  fingerprint?: string;
  port?: number;
  protocol?: 'http' | 'https';
  download?: boolean;
  announce?: boolean;
}

class LocalSendService {
  // One socket per usable IPv4 interface, keyed by that interface's address, so
  // discovery never hinges on the OS's default-interface choice (which on a
  // multi-homed / commercial box can be a disconnected NIC or a VPN adapter).
  private readonly sockets = new Map<string, dgram.Socket>();
  private announceTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private interfaceTimer: NodeJS.Timeout | null = null;
  private readonly devices = new Map<string, TrackedDevice>();
  private readonly transfers = new Map<string, Transfer>();
  private loadedIdentity: LocalSendIdentity | null = null;
  private agent: https.Agent | null = null;
  private started = false;
  private scanning = false;
  // On-demand discovery. `announceTimer` is set exactly while awake.
  private listener: RegisterListener | null = null;
  private awakeUntil = 0;
  private settled: Promise<void> = Promise.resolve();

  private get cfg() {
    return config.localsend;
  }

  /**
   * Our certificate, key and the fingerprint they give us. Read on first use rather than at
   * import: the first run generates an RSA key, and this module is imported with LocalSend off.
   */
  private get identity(): LocalSendIdentity {
    return (this.loadedIdentity ??= loadOrCreateIdentity(IDENTITY_FILE));
  }

  /**
   * Every HTTPS request presents the identity: receivers on 1.18+ end the handshake without it.
   *
   * It is given as ONE TLS context. Handed the PEMs instead, Node parses the key again for each
   * connection, and a subnet scan opens some 250 per interface: measured on the clinic's server,
   * that was a second of event-loop time where the shared context takes a tenth of one.
   */
  private get httpsAgent(): https.Agent {
    return (this.agent ??= new https.Agent({
      rejectUnauthorized: false,
      secureContext: tls.createSecureContext({ cert: this.identity.certPem, key: this.identity.keyPem }),
    }));
  }

  /** What we tell a device about ourselves: the answer to its `register` and `info`. */
  private peerInfo(): PeerInfo {
    return {
      alias: this.cfg.alias,
      version: LOCALSEND_VERSION,
      deviceModel: 'Server',
      deviceType: 'server',
      fingerprint: this.identity.fingerprint,
      download: false,
    };
  }

  /** Our own identity, sent in announcements and prepare-upload `info`. */
  private selfInfo(): AnnouncePayload {
    return { ...this.peerInfo(), port: this.cfg.port, protocol: 'https' };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    // Before anything announces it. The first run generates the identity here, at boot,
    // rather than under the first send.
    log.info('[LocalSend] Device identity ready', { fingerprint: this.identity.fingerprint });
    this.started = true;

    // Bind every usable interface that exists right now, to hear the devices that announce
    // themselves. Nothing is sent: announcing begins when the picker is first read (`wake`).
    this.syncInterfaces();

    this.pruneTimer = setInterval(() => this.prune(), DEVICE_TTL_MS);
    this.pruneTimer.unref();
    this.interfaceTimer = setInterval(() => this.syncInterfaces(), INTERFACE_SYNC_MS);
    this.interfaceTimer.unref();
  }

  // ── On-demand discovery ──────────────────────────────────────────────────

  /**
   * The picker is in use. Asleep, this starts discovery: the `register` listener opens, an
   * announcement goes out of every interface, and both keep going until `AWAKE_MS` after the
   * last call. Awake, it only moves that deadline.
   *
   * The promise is for the caller that is about to read the device list. An announcement's
   * answers arrive after it, so a list read at once on waking would be empty and the picker
   * would open on "No devices found". It resolves `SETTLE_MS` after the wake, and at once for a
   * call that finds discovery already settled.
   */
  wake(): Promise<void> {
    if (!this.started) return Promise.resolve();
    this.awakeUntil = Date.now() + AWAKE_MS;
    if (this.announceTimer) return this.settled;

    // The listener before the announcement: a device answers within milliseconds.
    this.listener = openRegisterListener({
      identity: this.identity,
      port: this.cfg.port,
      selfInfo: () => this.peerInfo(),
      onRegister: (registration) => this.onRegister(registration),
    });
    this.announce();
    this.announceTimer = setInterval(() => this.beat(), ANNOUNCE_INTERVAL_MS);
    this.announceTimer.unref();
    this.settled = new Promise((resolve) => {
      setTimeout(resolve, SETTLE_MS).unref();
    });
    log.info('[LocalSend] Discovery awake', { port: this.cfg.port });
    return this.settled;
  }

  /**
   * Every `ANNOUNCE_INTERVAL_MS` while awake: announce again, or go to sleep once the picker
   * has not been read for `AWAKE_MS`.
   */
  private beat(): void {
    if (Date.now() < this.awakeUntil) {
      this.announce();
      return;
    }
    log.info('[LocalSend] Discovery asleep — the picker has not been used for a while');
    void this.sleep();
  }

  /** Stop announcing and close the listener. Resolves when its port is free. */
  private sleep(): Promise<void> {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    const listener = this.listener;
    this.listener = null;
    return listener ? listener.close() : Promise.resolve();
  }

  /** A device answered an announcement the way 1.18+ does, or found us by asking our address. */
  private onRegister(registration: Registration): void {
    if (registration.fingerprint === this.identity.fingerprint) return;
    this.upsertDevice({
      fingerprint: registration.fingerprint,
      alias: registration.alias,
      deviceModel: registration.deviceModel,
      deviceType: registration.deviceType,
      ip: registration.ip,
      port: registration.port || DEFAULT_PEER_PORT,
      protocol: registration.protocol === 'http' ? 'http' : 'https',
    });
  }

  /**
   * Every non-internal IPv4 address on the box — physical NICs AND virtual ones
   * (e.g. ZeroTier, so devices on a VPN overlay are reachable too). Skips
   * loopback and 169.254 link-local (APIPA = a NIC with no working link, such as
   * an unplugged secondary port): those carry no real peers and only ever win the
   * OS default-interface lottery and black-hole our announces.
   */
  private usableInterfaceIps(): string[] {
    const ips: string[] = [];
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        if (a.address.startsWith('169.254.')) continue;
        ips.push(a.address);
      }
    }
    return ips;
  }

  /** Reconcile our per-interface sockets with the machine's current interfaces. */
  private syncInterfaces(): void {
    if (!this.started) return;
    const desired = new Set(this.usableInterfaceIps());

    // Drop sockets for interfaces that have gone away (cable pulled, VPN down).
    for (const [ip, sock] of this.sockets) {
      if (!desired.has(ip)) {
        try {
          sock.close();
        } catch {
          /* already closing */
        }
        this.sockets.delete(ip);
        log.info('[LocalSend] Interface gone — stopped listening', { ip });
      }
    }

    // Bind any interface we are not already listening on.
    for (const ip of desired) {
      if (!this.sockets.has(ip)) this.bindInterface(ip);
    }
  }

  /** Create + bind one discovery socket pinned to a single interface. */
  private bindInterface(ip: string): void {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.warn('[LocalSend] UDP port in use on interface — skipping (probe-by-IP still works)', {
          ip,
          port: this.cfg.port,
        });
      } else {
        log.warn('[LocalSend] Socket error on interface', { ip, error: err.message });
      }
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (this.sockets.get(ip) === socket) this.sockets.delete(ip);
    });

    socket.on('message', (msg, rinfo) => this.onMulticast(msg, rinfo, socket));

    // Register before bind() so the async error/listening handlers see it.
    this.sockets.set(ip, socket);

    socket.bind(this.cfg.port, () => {
      try {
        socket.setMulticastTTL(255);
        socket.setMulticastInterface(ip);              // pin OUTBOUND announces to this interface
        socket.addMembership(this.cfg.multicast, ip);  // receive group traffic arriving on it
      } catch (err) {
        // A transient / just-removed interface throws EADDRNOTAVAIL; drop it and
        // let the next syncInterfaces() retry once it has settled.
        log.warn('[LocalSend] Could not bind interface — will retry', {
          ip,
          error: (err as Error).message,
        });
        try {
          socket.close();
        } catch {
          /* already closing */
        }
        if (this.sockets.get(ip) === socket) this.sockets.delete(ip);
        return;
      }
      log.info('[LocalSend] Discovery listening on interface', {
        ip,
        port: this.cfg.port,
        multicast: this.cfg.multicast,
      });
      // An interface that came up while the picker is in use is announced on at once.
      if (this.announceTimer) this.announceFrom(socket);
    });
  }

  async gracefulShutdown(): Promise<void> {
    if (!this.started) return;
    log.info('[LocalSend] Shutting down…');
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.interfaceTimer) clearInterval(this.interfaceTimer);
    this.pruneTimer = null;
    this.interfaceTimer = null;
    await this.sleep();

    const closing = [...this.sockets.values()].map(
      (sock) =>
        new Promise<void>((resolve) => {
          try {
            sock.close(() => resolve());
          } catch {
            resolve();
          }
        })
    );
    this.sockets.clear();
    await Promise.all(closing);

    for (const t of this.transfers.values()) {
      t.canceled = true;
      t.abort.abort();
    }
    this.transfers.clear();
    this.devices.clear();
    this.started = false;
  }

  // ── Discovery ────────────────────────────────────────────────────────────

  /** Broadcast our presence (announce:true) out every interface to solicit replies. */
  private announce(): void {
    for (const socket of this.sockets.values()) this.announceFrom(socket);
  }

  private announceFrom(socket: dgram.Socket): void {
    const payload = JSON.stringify({ ...this.selfInfo(), announce: true });
    socket.send(payload, this.cfg.port, this.cfg.multicast, (err) => {
      if (err) log.debug('[LocalSend] announce send failed', { error: err.message });
    });
  }

  private onMulticast(msg: Buffer, rinfo: dgram.RemoteInfo, socket: dgram.Socket): void {
    let data: AnnouncePayload;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }
    if (!data.fingerprint || data.fingerprint === this.identity.fingerprint) return;

    this.upsertDevice({
      fingerprint: data.fingerprint,
      alias: data.alias || 'Unknown device',
      deviceModel: data.deviceModel,
      deviceType: data.deviceType,
      ip: rinfo.address,
      port: data.port || DEFAULT_PEER_PORT,
      protocol: data.protocol === 'http' ? 'http' : 'https',
    });

    // Reply to a solicitation on the SAME interface it arrived on (announce:false), while
    // awake. Asleep, the device above is remembered and nothing is said: a reply is what puts
    // this server on that device's list.
    if (data.announce && this.announceTimer) {
      const reply = JSON.stringify({ ...this.selfInfo(), announce: false });
      socket.send(reply, rinfo.port, rinfo.address);
    }
  }

  private upsertDevice(d: LocalSendDevice): void {
    this.devices.set(d.fingerprint, { ...d, lastSeen: Date.now() });
  }

  private prune(): void {
    const cutoff = Date.now() - DEVICE_TTL_MS;
    for (const [fp, d] of this.devices) {
      if (d.lastSeen < cutoff) this.devices.delete(fp);
    }
    const tCutoff = Date.now() - TRANSFER_TTL_MS;
    for (const [id, t] of this.transfers) {
      if (t.settledAt && t.settledAt < tCutoff) this.transfers.delete(id);
    }
  }

  getDevices(): LocalSendDevice[] {
    const cutoff = Date.now() - DEVICE_TTL_MS;
    return [...this.devices.values()]
      .filter((d) => d.lastSeen >= cutoff)
      .map(({ lastSeen: _lastSeen, ...d }) => d);
  }

  /**
   * The picker's Rescan: solicit announcements, and ask the addresses on our own subnets directly.
   *
   * The second half finds a device our announcement does not reach (an access point that keeps
   * multicast from its Wi-Fi clients, a device whose answer was refused): it cannot answer what
   * it never heard. Until the `register` listener existed it was the only way a 1.18+ device
   * entered the picker, and on 2026-10-10 a 1.18 phone was open and reachable for two minutes
   * without one of its own announcements arriving here. LocalSend's apps fall back to the same
   * sweep when multicast brings them nothing.
   */
  scan(): void {
    // Rescan is a use of the picker like any other. Waking from sleep announces by itself.
    const wasAwake = this.announceTimer !== null;
    void this.wake();
    if (wasAwake) this.announce();
    void this.scanSubnets();
  }

  /**
   * Probe every other address on the /24 of each usable interface, without waiting for one before
   * asking the next. The ones running LocalSend enter the picker as they answer; the rest refuse
   * or time out. One scan at a time, however often Rescan is pressed.
   */
  private async scanSubnets(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const own = this.usableInterfaceIps();
      const addresses = new Set<string>();
      for (const ip of own) {
        const subnet = ip.slice(0, ip.lastIndexOf('.') + 1);
        for (let host = 1; host <= 254; host++) addresses.add(subnet + host);
      }
      for (const ip of own) addresses.delete(ip);

      const answers: Promise<boolean>[] = [];
      for (const ip of addresses) {
        // Settled where it is made: a refusal can arrive before the last probe has been sent.
        answers.push(this.probe(ip, SCAN_TIMEOUT_MS).then(() => true, () => false));
        // Opening a connection is synchronous work. Let other requests in between batches rather
        // than hold the event loop for all of them.
        if (answers.length % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
      log.info('[LocalSend] Subnet scan finished', {
        addresses: addresses.size,
        found: (await Promise.all(answers)).filter(Boolean).length,
      });
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Probe a device directly by IP via `GET …/v2/info`. Covers segmented LANs
   * and WSL2 dev, where multicast can't reach the physical network.
   */
  async probe(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<LocalSendDevice> {
    // Defense-in-depth behind the contract's IP validation: the value is
    // interpolated into a URL, so a host/port/path here would be an SSRF.
    if (net.isIP(ip) === 0) throw new Error('Not a valid IP address');
    const host = ip.includes(':') ? `[${ip}]` : ip; // bracket IPv6 for the URL
    // `cfg.port`, not the protocol default: everything else here honours LOCALSEND_PORT (the socket
    // bind, the announce, the advertised selfInfo().port), and a LAN that moved off 53317 moved as a
    // whole. Hardcoding the constant meant that on such a LAN multicast discovery worked while
    // probe-by-IP silently hit a dead port — and probe-by-IP is the fallback that exists precisely
    // for the segmented LANs and WSL2 dev boxes multicast can't reach.
    const url = `https://${host}:${this.cfg.port}/api/localsend/v2/info`;
    let info: AnnouncePayload;
    try {
      const res = await this.timedFetch(url, { agent: this.httpsAgent }, timeoutMs);
      if (!res.ok) {
        throw new Error(`The device at ${ip} answered, but not as LocalSend (HTTP ${res.status})`);
      }
      info = (await res.json()) as AnnouncePayload;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('The device at ')) throw err;
      if (err instanceof SyntaxError || (err as { type?: unknown })?.type === 'invalid-json') {
        throw new Error(`The device at ${ip} answered, but not as LocalSend`, { cause: err });
      }
      throw new Error(describeUnreachable(err, `The device at ${ip}`, timeoutMs, "didn't answer"), {
        cause: err,
      });
    }
    // While awake our own listener answers on every address this machine has. The sweep leaves
    // those out; an address typed into "Add by IP" can still be one of them.
    if (info.fingerprint === this.identity.fingerprint) {
      throw new Error(`The device at ${ip} is this server itself`);
    }
    const dev: LocalSendDevice = {
      fingerprint: info.fingerprint || `ip:${ip}`,
      alias: info.alias || ip,
      deviceModel: info.deviceModel,
      deviceType: info.deviceType,
      ip,
      // `/info` carries no port, so the device's port is the one it just answered on. This fell
      // back to the protocol default, which sent every later upload to a port nobody had probed.
      port: info.port || this.cfg.port,
      protocol: info.protocol === 'http' ? 'http' : 'https',
    };
    this.upsertDevice(dev);
    return dev;
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  /**
   * Kick off a transfer and return its id IMMEDIATELY. The prepare-upload call
   * blocks on the receiver's Accept dialog (many seconds), and files can be
   * large, so the actual work runs detached and the client polls `getTransfer`.
   */
  async send(deviceId: string, refs: SendFileRef[], pin?: string): Promise<string> {
    const dev = this.devices.get(deviceId);
    if (!dev) throw new Error('Device not found — rescan and try again');

    const files: TransferFile[] = [];
    for (const ref of refs) {
      const resolved = await resolveShareRef(ref);
      files.push({
        name: resolved.name,
        status: 'pending',
        sentBytes: 0,
        totalBytes: resolved.size,
        abs: resolved.abs,
        fileType: resolved.fileType,
      });
    }

    const id = crypto.randomUUID();
    const transfer: Transfer = {
      id,
      status: 'pending',
      deviceId,
      deviceAlias: dev.alias,
      files,
      canceled: false,
      abort: new AbortController(),
    };
    this.transfers.set(id, transfer);

    // Detached — do NOT await. Errors are captured onto the transfer record.
    void this.runTransfer(transfer, dev, pin).catch((err) => {
      // A cancel() abort surfaces here as an AbortError — the record is already
      // settled as 'canceled'; don't overwrite it with 'failed'.
      if (transfer.canceled) return;
      transfer.status = 'failed';
      transfer.error = (err as Error).message;
      transfer.settledAt = Date.now();
      log.error('[LocalSend] transfer crashed', { id, error: (err as Error).message });
    });

    return id;
  }

  getTransfer(id: string): TransferStatus | null {
    const t = this.transfers.get(id);
    if (!t) return null;
    return {
      id: t.id,
      status: t.status,
      deviceAlias: t.deviceAlias,
      files: t.files.map((f) => ({
        name: f.name,
        status: f.status,
        sentBytes: f.sentBytes,
        totalBytes: f.totalBytes,
      })),
      ...(t.error ? { error: t.error } : {}),
    };
  }

  cancel(id: string): boolean {
    const t = this.transfers.get(id);
    if (!t) return false;
    const wasActive =
      t.status === 'pending' || t.status === 'sending' || t.status === 'pin-required';
    t.canceled = true;
    if (wasActive) {
      t.status = 'canceled';
      t.settledAt = Date.now();
      // Kill the in-flight HTTP request NOW — mid-file this stops the bytes, and
      // during the Accept dialog the dropped prepare-upload dismisses it.
      t.abort.abort();
      // Once the receiver accepted (sessionId known), also send the protocol
      // cancel so its progress UI doesn't sit on a dangling session.
      const r = t.remote;
      if (r?.sessionId) {
        const url = `${r.base}/cancel?sessionId=${encodeURIComponent(r.sessionId)}`;
        void this.timedFetch(url, { method: 'POST', agent: r.agent }, 10_000).catch(() => {
          /* best effort */
        });
      }
    }
    return true;
  }

  /** prepare-upload → per-file upload. Mutates `transfer` as it progresses. */
  private async runTransfer(
    transfer: Transfer,
    dev: TrackedDevice | LocalSendDevice,
    pin?: string
  ): Promise<void> {
    const base = `${dev.protocol}://${dev.ip}:${dev.port}/api/localsend/v2`;
    const agent = dev.protocol === 'https' ? this.httpsAgent : undefined;
    transfer.remote = { base, agent };

    // ── prepare-upload (blocks on the receiver's Accept dialog) ──
    const fileMap: Record<string, unknown> = {};
    transfer.files.forEach((f, idx) => {
      const fileId = String(idx);
      fileMap[fileId] = {
        id: fileId,
        fileName: f.name,
        size: f.totalBytes,
        fileType: f.fileType,
      };
    });

    const prepUrl = base + '/prepare-upload' + (pin ? `?pin=${encodeURIComponent(pin)}` : '');
    let prepRes: Awaited<ReturnType<typeof fetch>>;
    try {
      prepRes = await this.timedFetch(
        prepUrl,
        {
          method: 'POST',
          agent,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ info: this.selfInfo(), files: fileMap }),
        },
        PREPARE_TIMEOUT_MS,
        transfer.abort.signal
      );
    } catch (err) {
      if (transfer.canceled) return;
      // prepare-upload blocks on the receiver's Accept prompt, so a timeout HERE
      // usually means nobody tapped Accept — not that anything was cancelled.
      throw new Error(
        describeUnreachable(err, dev.alias, PREPARE_TIMEOUT_MS, "didn't accept the files — nobody tapped Accept, or it went to sleep"),
        { cause: err }
      );
    }

    if (transfer.canceled) return;

    if (prepRes.status === 401) {
      transfer.status = 'pin-required';
      transfer.settledAt = Date.now();
      return;
    }
    if (prepRes.status === 403) {
      transfer.status = 'declined';
      transfer.settledAt = Date.now();
      return;
    }
    if (prepRes.status === 204) {
      // Receiver already has every file — nothing to upload.
      transfer.files.forEach((f) => {
        f.status = 'completed';
        f.sentBytes = f.totalBytes;
      });
      transfer.status = 'completed';
      transfer.settledAt = Date.now();
      return;
    }
    if (prepRes.status === 409) {
      throw new Error(`${dev.alias} is busy with another transfer — try again in a moment`);
    }
    if (prepRes.status === 429) {
      throw new Error(`${dev.alias} is rate-limiting requests — try again in a moment`);
    }
    if (!prepRes.ok) {
      throw new Error(`prepare-upload failed (HTTP ${prepRes.status})`);
    }

    const prep = (await prepRes.json()) as {
      sessionId?: string;
      files?: Record<string, string>;
    };
    if (!prep.sessionId || !prep.files) {
      throw new Error('prepare-upload returned an unexpected payload');
    }
    transfer.remote.sessionId = prep.sessionId;

    transfer.status = 'sending';

    // ── upload each file's raw bytes ──
    for (let idx = 0; idx < transfer.files.length; idx++) {
      if (transfer.canceled) return;
      const f = transfer.files[idx];
      const fileId = String(idx);
      const token = prep.files[fileId];
      if (!token) {
        // Receiver chose not to accept this particular file.
        f.status = 'failed';
        continue;
      }

      f.status = 'sending';
      const uploadUrl =
        `${base}/upload?sessionId=${encodeURIComponent(prep.sessionId)}` +
        `&fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(token)}`;

      // Progress is counted on a PassThrough the file is piped THROUGH, not with a `data` listener
      // on the read stream. Two reasons:
      //
      //  1. A `data` listener switches the stream to flowing mode immediately. It only worked
      //     because node-fetch reaches `body.pipe(req)` in the same tick; inserting a single
      //     `await` between the two would start dropping the first chunks of every upload, and the
      //     symptom (a file that arrives short) points nowhere near the cause.
      //  2. A read stream races ahead of the socket on a LAN-speed mismatch, so the bar hit 100%
      //     while the transfer was still going — the one moment a user is most likely to decide it
      //     has hung and cancel a working send. A PassThrough is bounded by its own backpressure,
      //     so it tracks what the receiver is actually taking.
      const stream = createReadStream(f.abs);
      const counter = new PassThrough();
      counter.on('data', (chunk: Buffer) => {
        f.sentBytes = Math.min(f.sentBytes + chunk.length, f.totalBytes);
      });
      stream.on('error', (err) => counter.destroy(err));
      stream.pipe(counter);

      try {
        const upRes = await this.timedFetch(
          uploadUrl,
          {
            method: 'POST',
            agent,
            body: counter,
            // The size is known — advertise it instead of chunked encoding
            // (strict third-party receivers reject chunked uploads).
            headers: { 'Content-Length': String(f.totalBytes) },
          },
          UPLOAD_TIMEOUT_MS,
          transfer.abort.signal
        );
        if (!upRes.ok) {
          throw new Error(`upload of "${f.name}" failed (HTTP ${upRes.status})`);
        }
      } catch (err) {
        stream.destroy(); // don't leak the fd on abort/timeout/error
        counter.destroy();
        if (transfer.canceled) return; // cancel() already settled the record
        f.status = 'failed';
        // An HTTP-status failure above is already user copy; a transport failure is not.
        if (err instanceof Error && err.message.startsWith('upload of ')) throw err;
        throw new Error(
          describeUnreachable(err, dev.alias, UPLOAD_TIMEOUT_MS, `stopped taking "${f.name}"`),
          { cause: err }
        );
      }
      f.status = 'completed';
      f.sentBytes = f.totalBytes;
    }

    if (transfer.canceled) return;
    transfer.status = transfer.files.every((f) => f.status === 'completed')
      ? 'completed'
      : 'failed';
    if (transfer.status === 'failed' && !transfer.error) {
      transfer.error = 'Some files were not accepted by the device';
    }
    transfer.settledAt = Date.now();
  }

  /**
   * node-fetch wrapped in an AbortController timeout (v3 dropped `timeout`).
   * An optional external `signal` (a transfer's cancel) also aborts the request.
   */
  private async timedFetch(
    url: string,
    opts: Parameters<typeof fetch>[1],
    timeoutMs: number,
    signal?: AbortSignal
  ): ReturnType<typeof fetch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    const onAbort = (): void => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

}

export const localsendService = new LocalSendService();
export default localsendService;
