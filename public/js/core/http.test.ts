/**
 * Unit tests for the core/http funnel — the single point every staff-app
 * request flows through. Covers the behaviors everything else relies on:
 * envelope unwrap (H4), fail-loud schema validation (H11), CSRF attach +
 * transparent 403 retry (H2), timeout/retry semantics (M8), and
 * httpErrorMessage extraction.
 *
 * The module holds state (the cached CSRF token), so tests that touch CSRF
 * import a FRESH copy via importFresh().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type HttpModule = typeof import('./http');

async function importFresh(): Promise<HttpModule> {
  vi.resetModules();
  return import('./http');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const csrfResponse = (token: string): Response => jsonResponse({ csrfToken: token });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('envelope unwrap (H4)', () => {
  it('unwraps { success: true, data } to the inner payload', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { a: 1 } }));
    await expect(fetchJSON('/api/x')).resolves.toEqual({ a: 1 });
  });

  it('passes a bare array through untouched', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse([1, 2, 3]));
    await expect(fetchJSON('/api/x')).resolves.toEqual([1, 2, 3]);
  });

  it('leaves { success: true } shapes WITHOUT a data key alone', async () => {
    const { fetchJSON } = await importFresh();
    const body = { success: true, user: { name: 'Admin' } };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    await expect(fetchJSON('/api/auth/me')).resolves.toEqual(body);
  });

  it('returns text for non-JSON responses', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(
      new Response('plain text', { status: 200, headers: { 'content-type': 'text/plain' } })
    );
    await expect(fetchJSON('/api/x')).resolves.toBe('plain text');
  });

  it('throws an HttpError carrying status and parsed body on non-2xx', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Nope' }, 400));
    await expect(fetchJSON('/api/x')).rejects.toMatchObject({
      status: 400,
      data: { error: 'Nope' },
    });
  });
});

describe('schema validation (H11)', () => {
  const schema = z.object({ a: z.number() });

  it('returns the parsed data when the schema matches', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { a: 1 } }));
    await expect(fetchJSON('/api/x', { schema })).resolves.toEqual({ a: 1 });
  });

  it('throws fail-loud with .validation issues on mismatch', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { a: 'wrong' } }));
    await expect(fetchJSON('/api/x', { schema })).rejects.toMatchObject({
      validation: expect.anything(),
    });
  });
});

describe('CSRF (H2)', () => {
  it('attaches x-csrf-token to mutations, fetching the token first', async () => {
    const { postJSON } = await importFresh();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/csrf-token'
        ? csrfResponse('tok-1')
        : jsonResponse({ success: true, data: { ok: true } })
    );

    await postJSON('/api/thing', { x: 1 });

    const postCall = fetchMock.mock.calls.find(([url]) => url === '/api/thing');
    expect(postCall).toBeDefined();
    const headers = (postCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('tok-1');
  });

  it('does not fetch a token for GETs', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: 1 }));
    await fetchJSON('/api/x');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/csrf-token')).toBe(false);
  });

  it('reuses the cached token across mutations (single-flight)', async () => {
    const { postJSON } = await importFresh();
    let tokenFetches = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/csrf-token') {
        tokenFetches++;
        return csrfResponse('tok-1');
      }
      return jsonResponse({ success: true, data: 1 });
    });

    await Promise.all([postJSON('/api/a', {}), postJSON('/api/b', {})]);
    await postJSON('/api/c', {});

    expect(tokenFetches).toBe(1);
  });

  it('refreshes the token and retries the mutation once on 403 EBADCSRFTOKEN', async () => {
    const { postJSON } = await importFresh();
    let tokenFetches = 0;
    let postAttempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/csrf-token') {
        tokenFetches++;
        return csrfResponse(`tok-${tokenFetches}`);
      }
      postAttempts++;
      return postAttempts === 1
        ? jsonResponse({ code: 'EBADCSRFTOKEN' }, 403)
        : jsonResponse({ success: true, data: { ok: 1 } });
    });

    await expect(postJSON('/api/thing', {})).resolves.toEqual({ ok: 1 });
    expect(postAttempts).toBe(2);
    const retryCall = fetchMock.mock.calls.filter(([url]) => url === '/api/thing')[1];
    const headers = (retryCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('tok-2');
  });

  it('gives up after the single CSRF retry (no infinite loop)', async () => {
    const { postJSON } = await importFresh();
    let postAttempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/csrf-token') return csrfResponse('tok');
      postAttempts++;
      return jsonResponse({ code: 'EBADCSRFTOKEN' }, 403);
    });

    await expect(postJSON('/api/thing', {})).rejects.toMatchObject({ status: 403 });
    expect(postAttempts).toBe(2);
  });
});

describe('timeout & retry (M8)', () => {
  it('aborts a hung request after timeoutMs with TimeoutError', async () => {
    vi.useFakeTimers();
    const { fetchJSON } = await importFresh();
    fetchMock.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal!.addEventListener('abort', () => reject(opts.signal!.reason));
        })
    );

    const pending = fetchJSON('/api/slow', { timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('retries an idempotent GET on 503 with backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const { fetchJSON } = await importFresh();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'up' }));

    const pending = fetchJSON('/api/x', { retries: 1 });
    const assertion = expect(pending).resolves.toBe('up');
    await vi.advanceTimersByTimeAsync(1000); // backoffMs(0)
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retriable status (400), even with retries', async () => {
    const { fetchJSON } = await importFresh();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    await expect(fetchJSON('/api/x', { retries: 2 })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries mutations, even on 503 with retries set', async () => {
    const { postJSON } = await importFresh();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/csrf-token' ? csrfResponse('tok') : jsonResponse({ error: 'down' }, 503)
    );

    await expect(postJSON('/api/x', {}, { retries: 3 })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/x')).toHaveLength(1);
  });
});

describe('httpErrorMessage', () => {
  it('prefers the server `error` field from the parsed body', async () => {
    const { httpErrorMessage } = await importFresh();
    const err = Object.assign(new Error('HTTP Error: 400 Bad Request'), {
      data: { error: 'Friendly server message' },
    });
    expect(httpErrorMessage(err, 'fallback')).toBe('Friendly server message');
  });

  it('falls back to `message` field, then Error.message, then the fallback', async () => {
    const { httpErrorMessage } = await importFresh();
    const withMessageField = Object.assign(new Error('boring'), {
      data: { message: 'From message field' },
    });
    expect(httpErrorMessage(withMessageField, 'fallback')).toBe('From message field');
    expect(httpErrorMessage(new Error('Plain error'), 'fallback')).toBe('Plain error');
    expect(httpErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
