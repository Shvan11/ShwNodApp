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
 * "Translate with AI" button surfaces it as an error; the new-patient background fill just logs it.
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

/**
 * Romanize a (typically Arabic/Kurdish) full name into an English first + last name. The model is
 * instructed to emit basic Latin letters only, and any non-Latin-1 characters in its output are
 * stripped (ignored, not rejected). `lastName` may be empty for a single-token name. Throws if
 * Gemini is unconfigured, the call fails, or nothing usable remains after stripping.
 */
export async function transliterateNameToEnglish(
  patientName: string | null | undefined
): Promise<TransliteratedName> {
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
      // Bound the call so a slow/overloaded model fails fast instead of hanging. The SDK retries
      // 5xx up to 5× by default (HttpRetryOptions.attempts); attempts:1 = no retries, and the 10s
      // timeout + abortSignal hard-cap the single attempt. A reject propagates to the caller.
      // `httpOptions.timeout` is forwarded as the server deadline; Gemini rejects anything under
      // 10s (400 INVALID_ARGUMENT), so 10000ms is the floor.
      httpOptions: { timeout: 10000, retryOptions: { attempts: 1 } },
      abortSignal: AbortSignal.timeout(10000),
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
