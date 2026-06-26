/**
 * Request validation middleware — Zod at the trust boundary.
 *
 * Usage:
 *   router.post('/login', validate({ body: loginSchema }), handler);
 *
 * On success: the parsed (and coerced) values are written back onto
 * req.body / req.params / req.query, so handlers read already-validated,
 * correctly-typed data. Derive the handler's type from the schema with
 * `z.infer<typeof schema>` — the schema is the single source of truth.
 *
 * On failure: a 400 via the shared ErrorResponses helper, with the flattened
 * Zod issues in `details` so the client knows which field was wrong.
 *
 * Boundaries only — see CLAUDE.md. Never validate Kysely/DB results (already
 * typed from types/db.d.ts) or internal function calls.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ErrorResponses } from '../utils/error-response.js';

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

// params/query before body so a bad route param short-circuits cheaply.
const TARGETS = ['params', 'query', 'body'] as const;

// Returns a param-agnostic RequestHandler: the middleware reads req.params /
// req.query / req.body generically, so it must not pin the route's param type.
// Typing it as the default `RequestHandler` (ParamsDictionary) makes Express's
// overload inference clash with handlers typed `Request<{ id: string }>` when
// validate() precedes them — `<any, ...>` lets the handler's own params win.
export function validate(schemas: ValidationSchemas): RequestHandler<any, any, any, any> {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const key of TARGETS) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        ErrorResponses.badRequest(res, `Invalid request ${key}`, {
          source: key,
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.') || key,
            message: issue.message,
          })),
        });
        return;
      }

      // Write the parsed/coerced result back so handlers read validated,
      // coerced, defaulted values — not the raw input.
      const parsed = result.data;

      if (key === 'query') {
        // Express 5 exposes req.query as a prototype GETTER that RE-PARSES the
        // URL on every access (no caching). Mutating the object it returns is
        // futile — the next read re-parses and discards the change, dropping all
        // Zod coercion/defaults/transforms. Shadow the getter with an own data
        // property holding the parsed result so req.query is stable and coerced.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        continue;
      }

      // params/body are real own-properties, so in-place mutation persists. Keep
      // the existing object reference (mutate in place) rather than reassigning.
      const target = req[key] as Record<string, unknown> | undefined;
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        for (const existing of Object.keys(target)) delete target[existing];
        Object.assign(target, parsed as Record<string, unknown>);
      } else if (key === 'body') {
        // body may be undefined/primitive; reassigning the reference is allowed.
        req.body = parsed;
      }
    }
    next();
  };
}

export default validate;
