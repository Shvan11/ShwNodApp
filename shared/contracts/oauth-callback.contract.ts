/**
 * API contract — the OAuth redirect callbacks (`/api/admin/<provider>/callback`).
 *
 * REQUEST-SIDE ONLY. These endpoints are browser redirects, not enveloped JSON
 * routes: they answer with a 302 back to Settings → Integrations carrying a
 * status flag, so there is no `response` schema to author. What they DO have is
 * an untrusted query string coming straight off the provider's redirect, which
 * belongs in a contract like every other request shape (CLAUDE.md: a request
 * type is never hand-written next to the route).
 *
 * `code`/`state`/`error` are each optional because the provider sends `code` +
 * `state` on success and `error` on refusal, and the handler branches on which
 * arrived. Declaring them as scalars is itself a guard: a repeated parameter
 * (`?code=a&code=b`) arrives as an array from Express's query parser and 400s
 * here instead of reaching `getToken()` as an array.
 */
import { z } from 'zod';

export const oauthCallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuery>;
