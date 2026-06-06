/**
 * LocalSend sender service — pushes patient files/images to LAN devices.
 *
 * The clinic server acts as a LocalSend SENDER (protocol v2): it discovers
 * receivers over UDP multicast, then uploads a file straight to the chosen
 * device, which shows its native Accept prompt. The browser can't do either of
 * those (no multicast, no POST to self-signed-HTTPS LAN hosts), so all of it
 * lives here and the React UI just drives it over our HTTP funnel.
 *
 * The server is an HTTPS *client* only — it accepts the receivers' self-signed
 * certs (`rejectUnauthorized:false`, the protocol's LAN-internal design) and
 * needs no cert of its own. It does NOT host a `:53317` HTTP listener.
 *
 * Gated by `config.localsend.enabled` (off by default). Discovery degrades
 * gracefully on `EADDRINUSE` — probe-by-IP still works.
 */
import dgram from 'dgram';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import https from 'https';
import path from 'path';
import { stat } from 'fs/promises';
import fetch from 'node-fetch';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import {
  resolveFileForServe,
  FileExplorerError,
} from '../files/file-explorer.service.js';
import { getFileMimeType } from '../../utils/file-mime.js';
import type {
  LocalSendDevice,
  SendFileRef,
  TransferStatus,
  TransferState,
} from '../../shared/contracts/localsend.contract.js';

const LOCALSEND_VERSION = '2.0';
const MULTICAST_PORT = 53317;
// How long a discovered/probed device stays in the picker without being re-seen.
const DEVICE_TTL_MS = 5 * 60 * 1000;
// We solicit announcements this often while running.
const ANNOUNCE_INTERVAL_MS = 5 * 1000;
// Bounds the prepare-upload wait — the receiver's Accept dialog can sit open.
const PREPARE_TIMEOUT_MS = 90 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
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
  private socket: dgram.Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private readonly devices = new Map<string, TrackedDevice>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly fingerprint = crypto.randomUUID();
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });
  private started = false;

  private get cfg() {
    return config.localsend;
  }

  /** Our own identity, sent in announcements and prepare-upload `info`. */
  private selfInfo(): AnnouncePayload {
    return {
      alias: this.cfg.alias,
      version: LOCALSEND_VERSION,
      deviceModel: 'Server',
      deviceType: 'server',
      fingerprint: this.fingerprint,
      port: this.cfg.port,
      protocol: 'https',
      download: false,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.warn(
          '[LocalSend] UDP port in use — multicast discovery disabled (probe-by-IP still works)',
          { port: this.cfg.port }
        );
      } else {
        log.error('[LocalSend] UDP socket error', { error: err.message });
      }
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (this.socket === socket) this.socket = null;
    });

    socket.on('message', (msg, rinfo) => this.onMulticast(msg, rinfo));

    socket.bind(this.cfg.port, () => {
      try {
        socket.addMembership(this.cfg.multicast);
        socket.setMulticastTTL(255);
      } catch (err) {
        log.warn('[LocalSend] Could not join multicast group', {
          error: (err as Error).message,
        });
      }
      log.info('[LocalSend] Discovery listening', {
        port: this.cfg.port,
        multicast: this.cfg.multicast,
        alias: this.cfg.alias,
      });
      this.announce();
    });

    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
    this.announceTimer.unref();
    this.pruneTimer = setInterval(() => this.prune(), DEVICE_TTL_MS);
    this.pruneTimer.unref();
  }

  async gracefulShutdown(): Promise<void> {
    if (!this.started) return;
    log.info('[LocalSend] Shutting down…');
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.announceTimer = null;
    this.pruneTimer = null;
    if (this.socket) {
      await new Promise<void>((resolve) => {
        try {
          this.socket!.close(() => resolve());
        } catch {
          resolve();
        }
      });
      this.socket = null;
    }
    for (const t of this.transfers.values()) t.canceled = true;
    this.transfers.clear();
    this.devices.clear();
    this.started = false;
  }

  // ── Discovery ────────────────────────────────────────────────────────────

  /** Broadcast our presence (announce:true) to solicit replies. */
  private announce(): void {
    if (!this.socket) return;
    const payload = JSON.stringify({ ...this.selfInfo(), announce: true });
    this.socket.send(payload, this.cfg.port, this.cfg.multicast, (err) => {
      if (err) log.debug('[LocalSend] announce send failed', { error: err.message });
    });
  }

  private onMulticast(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    let data: AnnouncePayload;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }
    if (!data.fingerprint || data.fingerprint === this.fingerprint) return;

    this.upsertDevice({
      fingerprint: data.fingerprint,
      alias: data.alias || 'Unknown device',
      deviceModel: data.deviceModel,
      deviceType: data.deviceType,
      ip: rinfo.address,
      port: data.port || MULTICAST_PORT,
      protocol: data.protocol === 'http' ? 'http' : 'https',
    });

    // Reply to a solicitation so the peer learns about us too (announce:false).
    if (data.announce && this.socket) {
      const reply = JSON.stringify({ ...this.selfInfo(), announce: false });
      this.socket.send(reply, rinfo.port, rinfo.address);
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

  /** Re-solicit announcements (the picker's Rescan button). */
  scan(): void {
    this.announce();
  }

  /**
   * Probe a device directly by IP via `GET …/v2/info`. Covers segmented LANs
   * and WSL2 dev, where multicast can't reach the physical network.
   */
  async probe(ip: string): Promise<LocalSendDevice> {
    const url = `https://${ip}:${MULTICAST_PORT}/api/localsend/v2/info`;
    const res = await this.timedFetch(url, { agent: this.httpsAgent }, 8000);
    if (!res.ok) {
      throw new Error(`Device at ${ip} did not respond (HTTP ${res.status})`);
    }
    const info = (await res.json()) as AnnouncePayload;
    const dev: LocalSendDevice = {
      fingerprint: info.fingerprint || `ip:${ip}`,
      alias: info.alias || ip,
      deviceModel: info.deviceModel,
      deviceType: info.deviceType,
      ip,
      port: info.port || MULTICAST_PORT,
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
      const resolved = await this.resolveRef(ref);
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
    };
    this.transfers.set(id, transfer);

    // Detached — do NOT await. Errors are captured onto the transfer record.
    void this.runTransfer(transfer, dev, pin).catch((err) => {
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
    t.canceled = true;
    if (t.status === 'pending' || t.status === 'sending' || t.status === 'pin-required') {
      t.status = 'canceled';
      t.settledAt = Date.now();
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
    const prepRes = await this.timedFetch(
      prepUrl,
      {
        method: 'POST',
        agent,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ info: this.selfInfo(), files: fileMap }),
      },
      PREPARE_TIMEOUT_MS
    );

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

      const stream = createReadStream(f.abs);
      stream.on('data', (chunk: string | Buffer) => {
        f.sentBytes += chunk.length;
      });

      const upRes = await this.timedFetch(
        uploadUrl,
        { method: 'POST', agent, body: stream },
        UPLOAD_TIMEOUT_MS
      );
      if (!upRes.ok) {
        f.status = 'failed';
        throw new Error(`upload of "${f.name}" failed (HTTP ${upRes.status})`);
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

  /** node-fetch wrapped in an AbortController timeout (v3 dropped `timeout`). */
  private async timedFetch(
    url: string,
    opts: Parameters<typeof fetch>[1],
    timeoutMs: number
  ): ReturnType<typeof fetch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // ── File resolution ──────────────────────────────────────────────────────

  /** Resolve a client `SendFileRef` to a guarded absolute path + metadata. */
  private async resolveRef(
    ref: SendFileRef
  ): Promise<{ abs: string; size: number; name: string; fileType: string }> {
    if (ref.source === 'patient-file') {
      const { abs, size } = await resolveFileForServe(ref.personId, ref.ref);
      return {
        abs,
        size,
        name: ref.displayName || path.basename(abs),
        fileType: getFileMimeType(abs),
      };
    }
    // patient-image — a rendered Dolphin view in the shared working/ dir.
    return this.resolveWorkingImage(ref);
  }

  /**
   * Safe resolver for a rendered patient image in the flat `working/` dir
   * (served to the browser as `/DolImgs/<basename>`). The basename must be a
   * bare Dolphin filename — no separators / traversal — and the resolved path
   * is containment-checked under `working/` (the real guard).
   */
  private async resolveWorkingImage(
    ref: SendFileRef
  ): Promise<{ abs: string; size: number; name: string; fileType: string }> {
    const basename = ref.ref;
    if (!/^\d+0\d+\.i\d+$/i.test(basename)) {
      throw new FileExplorerError('Invalid image reference', 400);
    }
    const machinePath = config.fileSystem.machinePath;
    if (!machinePath) throw new FileExplorerError('Server file path not configured', 500);
    const resolver = createPathResolver(machinePath);
    const root = resolver('working');
    const abs = resolver(`working/${basename}`);
    // Containment: the resolved path must stay under working/.
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new FileExplorerError('Path is outside the working folder', 403);
    }
    const st = await stat(abs).catch(() => {
      throw new FileExplorerError('Image not found', 404);
    });
    return {
      abs,
      size: st.size,
      name: ref.displayName || `${basename}.jpg`,
      fileType: 'image/jpeg',
    };
  }
}

export const localsendService = new LocalSendService();
export default localsendService;
