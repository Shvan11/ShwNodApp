/**
 * `sendError` must not leak a raw error message to the client in production.
 *
 * `middleware/error-handler.ts` documents itself as never emitting "the raw
 * Error.message, which historically leaked SQL fragments, file paths, and internal
 * state". `sendError` is the OTHER path to the client — ~140 call sites — and its
 * dev-gate covers only the `details instanceof Error` branch. Every call site that
 * hand-built `{ error: err.message }` instead therefore bypassed the gate and sent
 * the raw text in production; those are converted, and an ESLint selector in
 * `eslint.config.js` keeps them converted.
 *
 * These tests pin the runtime half — the gate itself, in both NODE_ENV modes — so
 * the guarantee the call sites now rely on cannot quietly regress.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Response } from 'express';
import { sendError, sendSuccess } from './error-response.js';

/** Minimal Response double: records status + JSON body, reports open/closed. */
function mockRes(overrides: Partial<Response> = {}) {
  const state = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    writableEnded: false,
    ...overrides,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    get writableEnded() {
      return state.writableEnded;
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      state.headersSent = true;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

const REAL_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = REAL_ENV;
});

type Body = { success: boolean; error?: string; details?: Record<string, unknown> };

describe('sendError — details from an Error', () => {
  const dbError = new Error(
    'insert or update on table "invoices" violates foreign key constraint "invoices_work_id_fkey"'
  );

  it('suppresses message AND stack in production', () => {
    process.env.NODE_ENV = 'production';
    const { res, state } = mockRes();
    sendError(res, 500, 'Failed to add payment', dbError);
    const body = state.body as Body;

    expect(state.statusCode).toBe(500);
    expect(body.error).toBe('Failed to add payment');
    expect(body.details).toEqual({});
    // The constraint name must not appear anywhere in the serialized response.
    expect(JSON.stringify(body)).not.toContain('invoices_work_id_fkey');
  });

  it('includes message and stack in development', () => {
    process.env.NODE_ENV = 'development';
    const { res, state } = mockRes();
    sendError(res, 500, 'Failed to add payment', dbError);
    const body = state.body as Body;

    expect(body.details?.message).toBe(dbError.message);
    expect(body.details?.stack).toBeTruthy();
  });
});

describe('sendError — a plain details object still passes through', () => {
  it('keeps a field-level details object in production', () => {
    // This is why the fix had to happen at the CALL SITES rather than by scrubbing
    // keys inside sendError: legitimate details are load-bearing. `validate()` ships
    // Zod issues here, `useApiMutation` reads `details.code`, and BatchFormDrawer
    // reads `details.message`.
    process.env.NODE_ENV = 'production';
    const { res, state } = mockRes();
    sendError(res, 400, 'Invalid request body', {
      key: 'body',
      issues: [{ path: 'amountPaid', message: 'Amount cannot be negative' }],
    });
    const body = state.body as Body;

    expect(body.details?.key).toBe('body');
    expect(body.details?.issues).toHaveLength(1);
  });
});

describe('the isClosed guard', () => {
  it('makes a late sendError a no-op after headers are sent', () => {
    // The request-timeout middleware answers 408 and ends the response while the
    // overrunning handler is still running; its eventual sendError would otherwise
    // throw ERR_HTTP_HEADERS_SENT inside its own try, whose catch calls
    // internalError and throws a SECOND time into the global handler.
    const { res, state } = mockRes({ headersSent: true });
    sendError(res, 500, 'too late');
    expect(state.body).toBeUndefined();
    expect(state.statusCode).toBe(0);
  });

  it('makes a late sendSuccess a no-op after the response ended', () => {
    const { res, state } = mockRes({ writableEnded: true });
    sendSuccess(res, { ok: true });
    expect(state.body).toBeUndefined();
  });

  it('still writes on an open response', () => {
    const { res, state } = mockRes();
    sendSuccess(res, { ok: true }, 'done');
    expect((state.body as { data?: unknown }).data).toEqual({ ok: true });
  });
});
