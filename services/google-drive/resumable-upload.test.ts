// @vitest-environment node
/**
 * Tests for the resumable Drive upload: chunking, the final request carrying the total, resuming
 * from the offset Drive reports after a dropped request, and never opening a session for an empty
 * source. A fake Drive session stands in for Google; it keeps the bytes it was sent so the tests
 * can check the file it would have created, byte for byte.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uploadResumable, UPLOAD_URL } from './resumable-upload.js';

const SESSION = 'https://upload.example/session-1';
const CHUNK = 256 * 1024;

interface FakeDrive {
  fetch: typeof fetch;
  received: () => Buffer;
  requests: Array<{ method: string; url: string; range: string | null; bytes: number }>;
}

/**
 * A Drive upload session. `failOn(n)` makes the n-th chunk PUT (1-based) throw like a dropped
 * connection AFTER Drive kept `keep` bytes of it — the case resuming exists for.
 */
function fakeDrive(opts: { dropChunk?: number; keepOnDrop?: number } = {}): FakeDrive {
  let held = Buffer.alloc(0);
  let chunkPuts = 0;
  const requests: FakeDrive['requests'] = [];

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const range = headers['Content-Range'] ?? null;
    const body = init?.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    requests.push({ method, url, range, bytes: body.length });

    if (method === 'POST' && url.startsWith(UPLOAD_URL)) {
      expect(headers.Authorization).toBe('Bearer tok');
      return new Response(null, { status: 200, headers: { location: SESSION } });
    }
    expect(url).toBe(SESSION);

    const status = range?.match(/^bytes \*\/(\*|\d+)$/);
    if (status) {
      if (status[1] !== '*' && Number(status[1]) === held.length) {
        return Response.json({ id: 'file-1' }, { status: 200 });
      }
      return new Response(null, {
        status: 308,
        headers: held.length ? { range: `bytes=0-${held.length - 1}` } : {},
      });
    }

    const m = range?.match(/^bytes (\d+)-(\d+)\/(\*|\d+)$/);
    if (!m) throw new Error(`bad Content-Range ${range}`);
    const from = Number(m[1]);
    expect(from).toBe(held.length); // never a gap, never a duplicate
    expect(Number(m[2]) - from + 1).toBe(body.length);
    chunkPuts++;
    if (chunkPuts === opts.dropChunk) {
      held = Buffer.concat([held, body.subarray(0, opts.keepOnDrop ?? 0)]);
      throw new TypeError('fetch failed');
    }
    held = Buffer.concat([held, body]);
    if (m[3] !== '*' && Number(m[3]) === held.length) return Response.json({ id: 'file-1' }, { status: 200 });
    return new Response(null, { status: 308, headers: { range: `bytes=0-${held.length - 1}` } });
  };

  return { fetch: impl as typeof fetch, received: () => held, requests };
}

async function* pieces(data: Buffer, size = 10_000): AsyncGenerator<Buffer> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

const payload = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + 3) % 251));
const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');

const run = (data: Buffer, drive: FakeDrive, progress: number[] = []) =>
  uploadResumable(pieces(data), {
    metadata: { name: 'x.dump' },
    contentType: 'application/octet-stream',
    getAccessToken: async () => 'tok',
    onProgress: (b) => progress.push(b),
    fetchImpl: drive.fetch,
    chunkSize: CHUNK,
    sleep: async () => {},
  });

describe('uploadResumable', () => {
  it('sends whole chunks, then a final request that carries the total', async () => {
    const data = payload(CHUNK * 2 + 1234);
    const drive = fakeDrive();
    const progress: number[] = [];
    const result = await run(data, drive, progress);

    expect(result).toEqual({ id: 'file-1', bytes: data.length, md5: md5(data) });
    expect(drive.received().equals(data)).toBe(true);
    const puts = drive.requests.filter((r) => r.method === 'PUT').map((r) => r.range);
    expect(puts).toEqual([
      `bytes 0-${CHUNK - 1}/*`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/*`,
      `bytes ${2 * CHUNK}-${data.length - 1}/${data.length}`,
    ]);
    expect(progress.at(-1)).toBe(data.length);
  });

  it('holds back an exact multiple of the chunk size so the last request still carries bytes', async () => {
    const data = payload(CHUNK * 2);
    const drive = fakeDrive();
    await run(data, drive);
    const puts = drive.requests.filter((r) => r.method === 'PUT');
    expect(puts.at(-1)).toMatchObject({ range: `bytes ${CHUNK}-${2 * CHUNK - 1}/${2 * CHUNK}`, bytes: CHUNK });
    expect(drive.received().equals(data)).toBe(true);
  });

  it('resumes from the offset Drive reports after a dropped chunk', async () => {
    const data = payload(CHUNK * 3 + 99);
    const drive = fakeDrive({ dropChunk: 2, keepOnDrop: 1000 });
    const result = await run(data, drive);

    expect(result?.md5).toBe(md5(data));
    expect(drive.received().equals(data)).toBe(true);
    // The status check, then the rest of chunk 2 from where Drive got to.
    const ranges = drive.requests.map((r) => r.range);
    expect(ranges).toContain('bytes */*');
    expect(ranges).toContain(`bytes ${CHUNK + 1000}-${2 * CHUNK - 1}/*`);
  });

  it('opens no session at all for an empty source', async () => {
    const drive = fakeDrive();
    expect(await run(Buffer.alloc(0), drive)).toBeNull();
    expect(drive.requests).toHaveLength(0);
  });

  it('gives up after repeated failures instead of retrying forever', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      uploadResumable(pieces(payload(10)), {
        metadata: {},
        contentType: 'application/octet-stream',
        getAccessToken: async () => 'tok',
        fetchImpl: failing,
        sleep: async () => {},
      })
    ).rejects.toThrow(/Could not reach Google Drive/);
  });

  it('does not retry a token that cannot be refreshed', async () => {
    let calls = 0;
    const drive = fakeDrive();
    await expect(
      uploadResumable(pieces(payload(10)), {
        metadata: {},
        contentType: 'application/octet-stream',
        getAccessToken: async () => {
          calls++;
          throw new Error('invalid_grant');
        },
        fetchImpl: drive.fetch,
        sleep: async () => {},
      })
    ).rejects.toThrow('invalid_grant');
    expect(calls).toBe(1);
  });
});
