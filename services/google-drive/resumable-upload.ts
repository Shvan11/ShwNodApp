/**
 * Stream a file of unknown length into Google Drive with Drive's RESUMABLE upload protocol.
 *
 * WHY NOT `drive.files.create({ media })`. googleapis sends that as ONE multipart request, which
 * leaves two bad choices for a database dump: give the request a timeout and cap how large a dump
 * can be on the clinic's uplink, or give it none and let a dropped packet hang it forever (the
 * outbound-timeout rule in CLAUDE.md). A dropped connection also restarts it from byte zero.
 *
 * Here the bytes go up in CHUNK_SIZE pieces, each request with its own timeout. When one fails, we
 * ask Drive how many bytes it holds and carry on from there, so a hiccup costs one chunk at most.
 * Only the chunk in flight is held in memory, and Drive creates the file only when the final chunk
 * lands: a run that fails part-way leaves nothing behind in the folder.
 *
 * The session is opened lazily, on the first byte, so a source that turns out to be empty (pg_dump
 * failing to start) never touches Drive at all.
 *
 * Pure (fetch and the token are injected) so the protocol is unit-tested in the CI gate.
 */
import { createHash } from 'node:crypto';
import { describeFetchError } from '../../utils/fetch-timeout.js';

export const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** 8 MiB. The protocol requires every chunk but the last to be a multiple of 256 KiB. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

/** Opening the session and asking how far it got: small requests. */
const CONTROL_TIMEOUT_MS = 30_000;
/** One chunk: 8 MiB in five minutes still gets through on a ~220 kbit/s uplink. */
const CHUNK_TIMEOUT_MS = 5 * 60_000;
/** Tries per request before the upload is given up on. */
const MAX_ATTEMPTS = 5;

export interface ResumableUploadOptions {
  /** The Drive file resource to create (name, parents, appProperties, …). */
  metadata: Record<string, unknown>;
  contentType: string;
  /** A valid bearer token; called before every request, so a refresh mid-upload is picked up. */
  getAccessToken: () => Promise<string>;
  /** Bytes Drive has confirmed so far. */
  onProgress?: (bytes: number) => void;
  fetchImpl?: typeof fetch;
  chunkSize?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResumableUploadResult {
  id: string;
  bytes: number;
  /** Hex MD5 of every byte sent, to compare against Drive's `md5Checksum`. */
  md5: string;
}

/** A request that never got an HTTP answer (timeout, refused, reset): the one failure worth retrying. */
class NetworkFailure extends Error {}

const sessionExpired = (): Error =>
  new Error('The Google Drive upload session expired before the backup finished');

/** What Drive answered when asked where the upload stands. */
type SessionState = { done: true; id: string } | { done: false; received: number };

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `Range: bytes=0-42` → 43 bytes held. No header means Drive holds nothing yet. */
function receivedFromRange(header: string | null): number {
  const match = header?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

async function fileIdFrom(res: Response): Promise<string> {
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    throw new Error('Google Drive finished the upload but returned no file id');
  }
  return body.id;
}

async function refusal(res: Response, what: string): Promise<Error> {
  const text = (await res.text().catch(() => '')).slice(0, 300);
  return new Error(`Google Drive refused ${what} (HTTP ${res.status})${text ? `: ${text}` : ''}`);
}

/** A status worth another try: Drive's own advice is to retry 5xx and 429 with backoff. */
const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429 || status === 401;

/**
 * Upload `source` and return the new file's id. Returns `null` when the source yields no bytes —
 * nothing is created in Drive in that case, and the caller decides what an empty source means.
 */
export async function uploadResumable(
  source: AsyncIterable<Buffer | string>,
  options: ResumableUploadOptions
): Promise<ResumableUploadResult | null> {
  const {
    metadata,
    contentType,
    getAccessToken,
    onProgress,
    fetchImpl = fetch,
    chunkSize = CHUNK_SIZE,
    sleep = defaultSleep,
  } = options;

  const backoff = (attempt: number): Promise<void> => sleep(Math.min(1000 * 2 ** (attempt - 1), 16_000));

  /**
   * One request with a fresh token and its own timeout. A transport failure (timeout, refused,
   * reset) comes back as a NetworkFailure, the only error the callers retry; a token that cannot
   * be refreshed (a revoked grant) is thrown as it is, because retrying it cannot help.
   */
  const request = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
    const token = await getAccessToken();
    try {
      return await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new NetworkFailure(`Could not reach Google Drive (${describeFetchError(err, timeoutMs)})`, { cause: err });
    }
  };

  /** Open the upload session; its URL addresses every later request. */
  const openSession = async (): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await request(
          `${UPLOAD_URL}?uploadType=resumable`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Type': contentType,
            },
            body: JSON.stringify(metadata),
          },
          CONTROL_TIMEOUT_MS
        );
      } catch (err) {
        if (!(err instanceof NetworkFailure) || attempt >= MAX_ATTEMPTS) throw err;
        await backoff(attempt);
        continue;
      }
      if (res.ok) {
        const location = res.headers.get('location');
        if (!location) throw new Error('Google Drive opened no upload session (no Location header)');
        return location;
      }
      if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw await refusal(res, 'to start the upload');
    }
  };

  /**
   * Ask Drive how many bytes of the session it holds. `total` is null while the size is unknown.
   * `null` means Drive could not say just now (unreachable, 5xx), so the caller tries again.
   */
  const querySession = async (session: string, total: number | null): Promise<SessionState | null> => {
    let res: Response;
    try {
      res = await request(
        session,
        { method: 'PUT', headers: { 'Content-Range': `bytes */${total ?? '*'}` } },
        CONTROL_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof NetworkFailure) return null;
      throw err;
    }
    if (res.status === 200 || res.status === 201) return { done: true, id: await fileIdFrom(res) };
    if (res.status === 308) return { done: false, received: receivedFromRange(res.headers.get('range')) };
    if (res.status === 404 || res.status === 410) throw sessionExpired();
    if (isRetryableStatus(res.status)) return null;
    throw await refusal(res, 'a status check on the upload');
  };

  /**
   * Send `data`, which starts at byte `start` of the file. A non-final chunk (`total` null) resolves
   * once Drive holds all of it; the final chunk resolves with the new file's id.
   */
  const sendChunk = async (
    session: string,
    data: Buffer<ArrayBuffer>,
    start: number,
    total: number | null
  ): Promise<string | null> => {
    const end = start + data.length;
    let held = start; // how much of the file Drive has confirmed
    let failures = 0;

    for (;;) {
      if (held > end || held < start) {
        throw new Error(`Google Drive reported ${held} bytes received, outside the chunk ${start}–${end}`);
      }
      if (held === end && total === null) return null;

      const body = data.subarray(held - start);
      const range = body.length === 0 ? `bytes */${total}` : `bytes ${held}-${end - 1}/${total ?? '*'}`;

      let res: Response | null = null;
      let failure: Error | null = null;
      try {
        res = await request(session, { method: 'PUT', headers: { 'Content-Range': range }, body }, CHUNK_TIMEOUT_MS);
      } catch (err) {
        if (!(err instanceof NetworkFailure)) throw err;
        failure = err;
      }

      if (res) {
        if (res.status === 200 || res.status === 201) {
          if (total === null) throw new Error('Google Drive closed the upload before the last chunk');
          return fileIdFrom(res);
        }
        if (res.status === 308) {
          const received = receivedFromRange(res.headers.get('range'));
          if (received > held) {
            held = received;
            failures = 0;
            onProgress?.(held);
            continue;
          }
          failure = new Error('Google Drive accepted none of the chunk');
        } else if (res.status === 404 || res.status === 410) {
          throw sessionExpired();
        } else if (isRetryableStatus(res.status)) {
          failure = await refusal(res, 'part of the upload');
        } else {
          throw await refusal(res, 'part of the upload');
        }
      }

      // The request failed or stalled: back off, ask Drive where it got to, resume from there.
      failures++;
      if (failures >= MAX_ATTEMPTS) throw failure ?? new Error('Google Drive did not take the upload');
      await backoff(failures);
      const state = await querySession(session, total);
      if (!state) continue; // Drive could not say; the next attempt re-sends from `held`.
      if (state.done) {
        if (total === null) throw new Error('Google Drive closed the upload before the last chunk');
        return state.id;
      }
      held = state.received;
      onProgress?.(held);
    }
  };

  const hash = createHash('md5');
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let offset = 0; // bytes Drive holds; `pending` starts here
  let session: string | null = null;

  for await (const piece of source) {
    const buf = typeof piece === 'string' ? Buffer.from(piece) : piece;
    hash.update(buf);
    pending.push(buf);
    pendingBytes += buf.length;
    // Strictly more than a chunk: the tail is kept back so the LAST request always carries bytes
    // and the total, which is what tells Drive the file is complete.
    while (pendingBytes > chunkSize) {
      const joined = Buffer.concat(pending, pendingBytes);
      session ??= await openSession();
      await sendChunk(session, joined.subarray(0, chunkSize), offset, null);
      offset += chunkSize;
      const rest = joined.subarray(chunkSize);
      pending = [rest];
      pendingBytes = rest.length;
    }
  }

  const total = offset + pendingBytes;
  if (total === 0) return null;
  session ??= await openSession();
  const id = await sendChunk(session, Buffer.concat(pending, pendingBytes), offset, total);
  if (!id) throw new Error('Google Drive finished the upload but returned no file id');
  onProgress?.(total);
  return { id, bytes: total, md5: hash.digest('hex') };
}
