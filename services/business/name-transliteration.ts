/**
 * English transliteration of patient names via Gemini.
 *
 * Dolphin Imaging's patient-name columns are varchar with a Latin1 collation, so non-Latin (Arabic)
 * text is stored as '?'. When a patient has only an Arabic `patient_name` and no Latin First/Last, we
 * ask Gemini to romanize it so the CDC dolphin sink can replicate a searchable patient instead of a
 * '????' / empty-index row.
 *
 * Clean translate, no fallback: it either returns a romanized name or THROWS (not configured /
 * API error / no usable result). Callers decide what to do with the failure — the interactive
 * "Translate with AI" button surfaces it as an error (single 10s attempt, fail-fast); the
 * new-patient background fill goes through `transliterateNameForBackfill`, which retries on a
 * spaced schedule with a longer deadline and just logs a final failure.
 *
 * Resolves the client + model through `gemini-config` (DB-managed key, env fallback) — the same
 * config as the Stand vision scan.
 */
import { Type } from '@google/genai';
import { getGeminiClient, getGeminiModel } from './gemini-config.js';
import { log } from '../../utils/logger.js';

export interface TransliteratedName {
  firstName: string;
  lastName: string;
}

// Gemini rejects server deadlines under 10s (400 INVALID_ARGUMENT), so 10s is the floor.
const MIN_TIMEOUT_MS = 10_000;

// Retrying can't fix these — the backfill schedule stops immediately instead of burning calls.
const PERMANENT_ERRORS = ['No name to translate', 'Gemini is not configured'];

/**
 * Romanize a (typically Arabic/Kurdish) full name into an English first + last name. The model is
 * instructed to emit basic Latin letters only, and any non-Latin-1 characters in its output are
 * stripped (ignored, not rejected). `lastName` may be empty for a single-token name. Throws if
 * Gemini is unconfigured, the call fails, or nothing usable remains after stripping.
 *
 * One bounded attempt per call — `timeoutMs` (clamped to the 10s Gemini floor, default 10s)
 * hard-caps it. Retry policy belongs to the callers: the interactive button stays single-shot.
 */
export async function transliterateNameToEnglish(
  patientName: string | null | undefined,
  opts?: { timeoutMs?: number }
): Promise<TransliteratedName> {
  const timeoutMs = Math.max(opts?.timeoutMs ?? MIN_TIMEOUT_MS, MIN_TIMEOUT_MS);
  const name = patientName?.trim();
  if (!name) throw new Error('No name to translate');

  const ai = await getGeminiClient();
  if (!ai) throw new Error('Gemini is not configured');

  const prompt = `Transliterate this orthodontic patient's full name into English using only basic Latin letters, as commonly romanized for Kurdish/Arabic names. Split it into a first (given) name and a last (family) name. Use no Arabic script and no diacritics. If the name has only one token, use it as the first name and leave the last name empty.

Full name: ${name}`;

  const result = await ai.models.generateContent({
    model: await getGeminiModel(),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          firstName: { type: Type.STRING, description: 'Given name in English/Latin letters' },
          lastName: {
            type: Type.STRING,
            description: 'Family name in English/Latin letters (may be empty if the name has one token)',
          },
        },
        required: ['firstName', 'lastName'],
      },
      // Bound the call so a slow/overloaded model fails instead of hanging: `httpOptions.timeout`
      // is forwarded as the server deadline (X-Server-Timeout) and the abortSignal caps the
      // client side. This is genuinely ONE attempt — @google/genai only honors `retryOptions`
      // set on the client constructor (a request-level one is silently ignored) and our client
      // sets none, so the SDK does a plain un-retried fetch. A reject propagates to the caller.
      httpOptions: { timeout: timeoutMs },
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  // Keep only Latin-1-representable characters (what Dolphin's varchar/Latin1 columns can store)
  // and silently drop anything else — non-Latin output is ignored, not rejected. No fallback.
  const toLatin1 = (s: string): string => s.replace(/[^ -ÿ]/g, '').replace(/\s+/g, ' ').trim();
  const parsed = JSON.parse(result.text ?? '{}') as { firstName?: string; lastName?: string };
  const firstName = toLatin1(parsed.firstName ?? '');
  const lastName = toLatin1(parsed.lastName ?? '');
  if (!firstName) throw new Error('Translation produced no usable name');

  log.info('[transliterate] translated patient name', { source: name, firstName, lastName });
  return { firstName, lastName };
}

// Backfill schedule: 4 attempts at ~t+0 / +30s / +3min / +13min, each with a 45s deadline.
// Sized from prod logs (2026-06/07, ~58% failure): the 45s deadline absorbs the peak-hours
// slow-model 504s/aborts (14 of 18 failures hit the old 10s cap) and the spaced waits outlast
// the minutes-scale 503 "high demand" spikes (the other 4). Worst case per patient is 4 tiny
// ~90-token prompts, and a 5xx attempt produces no billable output — token cost is negligible.
const BACKFILL_TIMEOUT_MS = 45_000;
const BACKFILL_RETRY_DELAYS_MS = [30_000, 150_000, 600_000];

// unref() so a pending retry never holds the process open during graceful shutdown — the
// detached backfill just dies with the process, which is fine for a fire-and-forget fill.
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * Background variant for the create-patient auto-fill: the same clean translate, retried on a
 * spaced schedule so a transient Gemini timeout/overload still yields a name minutes later
 * instead of leaving the patient Arabic-only. No user is waiting on this path. Throws to the
 * caller only when every attempt is exhausted or the failure is permanent (unconfigured /
 * empty name). NOTE: a success can land minutes after creation — apply it with a
 * fill-only-if-still-empty write, never a blind overwrite.
 */
export async function transliterateNameForBackfill(
  patientName: string | null | undefined
): Promise<TransliteratedName> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transliterateNameToEnglish(patientName, { timeoutMs: BACKFILL_TIMEOUT_MS });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const delayMs = BACKFILL_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || PERMANENT_ERRORS.includes(message)) throw err;
      log.info('[transliterate] attempt failed, will retry', {
        attempt: attempt + 1,
        retryInMs: delayMs,
        error: message,
      });
      await sleep(delayMs);
    }
  }
}
