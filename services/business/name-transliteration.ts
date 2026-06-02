/**
 * English transliteration of patient names via Gemini.
 *
 * Dolphin Imaging's patient-name columns are varchar with a Latin1 collation, so non-Latin (Arabic)
 * text is stored as '?'. When a patient has only an Arabic `patient_name` and no Latin First/Last, we
 * ask Gemini to romanize it so the CDC dolphin sink can replicate a searchable patient instead of a
 * '????' / empty-index row. Best-effort: returns null if Gemini is unconfigured, errors, or yields
 * anything that isn't a clean Latin-1 first + last — callers then fall back to asking the user.
 *
 * Reuses the same @google/genai client + GEMINI_API_KEY / GEMINI_MODEL env as the Stand vision scan.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { log } from '../../utils/logger.js';

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  client = new GoogleGenAI({ apiKey });
  return client;
}

/** Latin-1 (CP1252) representable — the ceiling for what Dolphin's varchar/Latin1 columns can store. */
const isLatin1 = (s: string): boolean => /^[ -ÿ]+$/.test(s);

export interface TransliteratedName {
  firstName: string;
  lastName: string;
}

/**
 * Romanize a (typically Arabic/Kurdish) full name into an English first + last name. Returns null
 * unless BOTH a non-empty first and last name come back as clean Latin-1 (Dolphin needs a last name
 * for its searchable `patIndexName`); the caller falls back to manual entry otherwise.
 */
export async function transliterateNameToEnglish(
  patientName: string | null | undefined
): Promise<TransliteratedName | null> {
  const name = patientName?.trim();
  if (!name) return null;

  const ai = getClient();
  if (!ai) {
    log.warn('[transliterate] GEMINI_API_KEY not configured — skipping auto-transliteration');
    return null;
  }

  const prompt = `Transliterate this orthodontic patient's full name into English using only basic Latin letters, as commonly romanized for Kurdish/Arabic names. Split it into a first (given) name and a last (family) name. Use no Arabic script and no diacritics. If the name has only one token, use it as the first name and leave the last name empty.

Full name: ${name}`;

  try {
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview',
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
      },
    });

    const parsed = JSON.parse(result.text ?? '{}') as { firstName?: string; lastName?: string };
    const firstName = (parsed.firstName ?? '').trim();
    const lastName = (parsed.lastName ?? '').trim();

    if (!firstName || !lastName || !isLatin1(firstName) || !isLatin1(lastName)) {
      log.warn('[transliterate] Gemini returned an unusable name', { source: name, firstName, lastName });
      return null;
    }

    log.info('[transliterate] transliterated patient name', { source: name, firstName, lastName });
    return { firstName, lastName };
  } catch (err) {
    log.warn('[transliterate] Gemini transliteration failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
