/**
 * Monitoring contract — the browser-side error sink.
 *
 * `POST /api/client-error` is how the staff SPA ships failures it would otherwise
 * only `console.error` (render-boundary crashes, fail-loud contract drift, uncaught
 * window errors) up to Winston, so prod issues land in the logs instead of dying in
 * a user's console. Authored once here and consumed by both the Express route
 * (`validate({ body })` + `sendData(res, response, …)`) and the client reporter
 * (`public/js/core/error-reporter.ts`).
 */
import { z } from 'zod';

/**
 * Which browser-side feed raised the report — lets the logs be grouped/filtered:
 *  - react-render        → an ErrorBoundary caught a render/commit throw
 *  - query / mutation    → a React Query read/write surfaced a 5xx or contract-drift throw
 *  - window-error        → window 'error' (uncaught sync throw React can't catch)
 *  - unhandledrejection  → an unhandled promise rejection (async path React can't catch)
 */
export const CLIENT_ERROR_SOURCES = [
  'react-render',
  'query',
  'mutation',
  'window-error',
  'unhandledrejection',
] as const;

export const reportClientError = {
  body: z.object({
    source: z.enum(CLIENT_ERROR_SOURCES),
    message: z.string().min(1).max(4000),
    /** JS error stack, when present. */
    stack: z.string().max(16000).optional(),
    /** React component stack — render-boundary reports only. */
    componentStack: z.string().max(16000).optional(),
    /** location.href at the time of the error. */
    url: z.string().max(2000).optional(),
    /** navigator.userAgent. */
    userAgent: z.string().max(1000).optional(),
    /** HTTP status when the failure is an HttpError (query/mutation reports). */
    status: z.number().int().optional(),
    /** Failing query/mutation key (JSON), when known. */
    queryKey: z.string().max(2000).optional(),
    /** Zod issues (JSON) when the failure is a fail-loud contract-drift throw. */
    validation: z.string().max(16000).optional(),
    /** Client wall-clock ISO timestamp. */
    at: z.string().max(40).optional(),
  }),
  response: z.object({ ok: z.literal(true) }),
} as const;

export type ReportClientErrorBody = z.infer<typeof reportClientError.body>;
export type ReportClientErrorResponse = z.infer<typeof reportClientError.response>;
