// @vitest-environment node
/**
 * Tests for on-demand discovery: the service looks for devices only while the picker is in use.
 *
 * Until 2026-10-10 it announced every 5 s around the clock with nothing listening on its port.
 * A device on LocalSend 1.18+ answers an announcement only with an HTTPS `register` call to the
 * announcer, so every such phone knocked on a closed port every 5 s and entered the picker only
 * when Rescan swept the subnet. What is pinned here:
 *   1. asleep, the service sends nothing, answers nobody and has no port open;
 *   2. reading the picker wakes it, and that read waits for the answers it caused;
 *   3. a device's `register` puts it in the picker, known by the certificate it proved;
 *   4. it goes back to sleep some minutes after the picker was last read.
 *
 * UDP is a stand-in (nothing is announced on the machine's real network); the `register` side
 * is real TLS on a loopback port.
 */
import dgram from 'dgram';
import { EventEmitter } from 'events';
import fs from 'fs';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { TLSSocket } from 'tls';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localsend-discovery-'));

/** `port` is both the port announced and the one the `register` listener binds. */
const localsendConfig = { enabled: true, port: 0, alias: 'Clinic Server', multicast: '224.0.0.167' };

vi.mock('../../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config/config.js', () => ({ default: { localsend: localsendConfig } }));
vi.mock('../files/share-ref.js', () => ({ resolveShareRef: async () => ({}) }));
// The service keeps its identity under the app's `data/`; a test must never touch that file.
vi.mock('./identity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./identity.js')>()),
  IDENTITY_FILE: path.join(dir, 'identity.pem'),
}));

const { fingerprintOf, generateIdentity, loadOrCreateIdentity, IDENTITY_FILE } = await import('./identity.js');
const { localsendService } = await import('./localsend.service.js');

const server = loadOrCreateIdentity(IDENTITY_FILE);
const phone = generateIdentity();

/** A UDP socket that goes nowhere: it records what is sent, and a test plays what arrives. */
class FakeUdp extends EventEmitter {
  sent: { payload: Record<string, unknown>; port: number; address: string }[] = [];
  bind(_port: number, listening: () => void): void {
    queueMicrotask(listening);
  }
  setMulticastTTL(): void {}
  setMulticastInterface(): void {}
  addMembership(): void {}
  send(message: string, port: number, address: string, done?: (err: Error | null) => void): void {
    this.sent.push({ payload: JSON.parse(message) as Record<string, unknown>, port, address });
    done?.(null);
  }
  close(done?: () => void): void {
    done?.();
  }
  /** A datagram from a device at `address`. */
  hear(payload: Record<string, unknown>, address: string): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)), { address, port: 53317 });
  }
}

let udp = new FakeUdp();
const announcements = (): Record<string, unknown>[] =>
  udp.sent.filter((s) => s.address === localsendConfig.multicast).map((s) => s.payload);

/** What a 1.18 device does on hearing our announcement: `register`, over TLS, with its certificate. */
function register(identity = phone, alias = 'Galaxy Phone'): Promise<{ status: number; servedBy: string }> {
  const body = JSON.stringify({
    alias,
    version: '2.1',
    deviceModel: 'Samsung',
    deviceType: 'mobile',
    fingerprint: identity.fingerprint,
    port: 53317,
    protocol: 'https',
    download: false,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: localsendConfig.port,
        method: 'POST',
        path: '/api/localsend/v2/register',
        agent: false,
        rejectUnauthorized: false,
        cert: identity.certPem,
        key: identity.keyPem,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const certificate = (res.socket as TLSSocket).getPeerX509Certificate();
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, servedBy: certificate ? fingerprintOf(certificate.raw) : '' })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Whether anything accepts a TCP connection on our port. */
const portOpen = (): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect(localsendConfig.port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

beforeAll(async () => {
  // A port nothing else holds, for the listener to take when the service wakes.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '0.0.0.0', resolve));
  localsendConfig.port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));

  vi.spyOn(dgram, 'createSocket').mockImplementation(() => {
    udp = new FakeUdp();
    return udp as unknown as dgram.Socket;
  });
});
beforeEach(async () => {
  // One interface, and none by the time a test calls Rescan: its sweep then has no subnet to ask.
  vi.spyOn(os, 'networkInterfaces').mockReturnValue({
    lan: [{ address: '127.0.0.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '127.0.0.1/24' }],
  });
  localsendService.start();
  await Promise.resolve(); // the stand-in socket reports itself bound
});
afterEach(async () => {
  vi.useRealTimers();
  await localsendService.gracefulShutdown();
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('asleep', () => {
  it('sends nothing and has no port open until the picker is read', async () => {
    expect(udp.sent).toEqual([]);
    expect(await portOpen()).toBe(false);
  });

  it('still hears a device that announces itself, and does not answer it', () => {
    udp.hear({ alias: 'Old Phone', fingerprint: 'OLD-PHONE', port: 53317, protocol: 'https', announce: true }, '192.0.2.50');

    expect(localsendService.getDevices()).toEqual([expect.objectContaining({ alias: 'Old Phone', ip: '192.0.2.50' })]);
    expect(udp.sent).toEqual([]);
  });
});

describe('reading the picker', () => {
  it('announces, and waits for the answer: the device that registers is in the list that read gets', async () => {
    let settled = false;
    const woke = localsendService.wake().then(() => {
      settled = true;
    });

    expect(announcements()).toEqual([
      expect.objectContaining({ announce: true, alias: 'Clinic Server', fingerprint: server.fingerprint, port: localsendConfig.port, protocol: 'https' }),
    ]);

    // The phone answers as 1.18 does, and is served the certificate we announced.
    expect(await register()).toEqual({ status: 200, servedBy: server.fingerprint });
    expect(settled).toBe(false); // the read is still being held for answers like this one

    await woke;
    expect(localsendService.getDevices()).toEqual([
      { fingerprint: phone.fingerprint, alias: 'Galaxy Phone', deviceModel: 'Samsung', deviceType: 'mobile', ip: '127.0.0.1', port: 53317, protocol: 'https' },
    ]);
  });

  it('does not hold a second read, or announce again for it', async () => {
    await localsendService.wake();
    const sent = udp.sent.length;

    const before = performance.now();
    await localsendService.wake();
    expect(performance.now() - before).toBeLessThan(200);
    expect(udp.sent).toHaveLength(sent);
  });

  it('answers a device that announces itself while awake', async () => {
    await localsendService.wake();
    udp.hear({ alias: 'Old Phone', fingerprint: 'OLD-PHONE', port: 53317, protocol: 'https', announce: true }, '192.0.2.50');

    expect(udp.sent.at(-1)).toMatchObject({ address: '192.0.2.50', payload: { announce: false, fingerprint: server.fingerprint } });
  });

  it('does not list a caller that proves to be this server', async () => {
    await localsendService.wake();
    expect((await register(server, 'Clinic Server')).status).toBe(200);
    expect(localsendService.getDevices()).toEqual([]);
  });

  it('does not add itself when its own address is typed into "Add by IP"', async () => {
    await localsendService.wake();
    // Awake, the listener answers `info` on every address this machine has, this one included.
    await expect(localsendService.probe('127.0.0.1')).rejects.toThrow('The device at 127.0.0.1 is this server itself');
    expect(localsendService.getDevices()).toEqual([]);
  });

  it('is woken by Rescan as well', async () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({});
    localsendService.scan();
    expect(announcements()).toHaveLength(1);
    expect((await register()).status).toBe(200);
  });
});

describe('going back to sleep', () => {
  it('stops announcing and closes the port five minutes after the picker was last read', async () => {
    // The announce timer and the clock it reads; I/O and the settle wait stay real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await localsendService.wake();

    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(announcements().length).toBeGreaterThan(40); // one every 5 s
    expect(await portOpen()).toBe(true);

    // Read again: the five minutes run from here.
    await localsendService.wake();
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(await portOpen()).toBe(true);

    vi.advanceTimersByTime(60 * 1000 + 5000);
    await vi.waitFor(async () => expect(await portOpen()).toBe(false));
    const sent = udp.sent.length;
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(udp.sent).toHaveLength(sent);
  });

  it('wakes again the next time the picker is read', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await localsendService.wake();
    vi.advanceTimersByTime(5 * 60 * 1000 + 5000);
    await vi.waitFor(async () => expect(await portOpen()).toBe(false));

    const sent = announcements().length;
    await localsendService.wake();
    expect(announcements()).toHaveLength(sent + 1);
    expect((await register()).status).toBe(200);
  });

  it('closes the port when the app shuts down', async () => {
    await localsendService.wake();
    expect(await portOpen()).toBe(true);
    await localsendService.gracefulShutdown();
    expect(await portOpen()).toBe(false);
  });
});
