/**
 * Centralized Gemini (Google GenAI) configuration + client.
 *
 * The API key and model are runtime-managed from Settings → Integrations and
 * stored in the `options` table (DB-first), falling back to the GEMINI_API_KEY /
 * GEMINI_MODEL environment variables when no DB value is set. This lets the key be
 * rotated without editing `.env` or restarting the Windows service — the same
 * pattern as the runtime-managed Telegram session. Both the name-transliteration
 * and Stand vision-scan features resolve their client through here, so a config
 * change applies to both with no restart.
 *
 * NOTE: the `options` table is CDC-mirrored to Supabase, so a key stored here is
 * replicated to the failover mirror (consistent with the Telegram session, which
 * is deliberately mirrored). The env var stays the deploy-time default.
 */
import { GoogleGenAI } from '@google/genai';
import { getOption, upsertOption } from '../database/queries/options-queries.js';

const OPT_API_KEY = 'gemini_api_key';
const OPT_MODEL = 'gemini_model';
export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

// Cache the client keyed by the resolved API key, so a key change (via settings)
// transparently rebuilds it on next use — no restart, no stale singleton.
let cached: { key: string; client: GoogleGenAI } | null = null;

/** Effective API key: DB option (if non-empty) → env → null. */
async function resolveApiKey(): Promise<string | null> {
  const dbVal = (await getOption(OPT_API_KEY))?.trim();
  if (dbVal) return dbVal;
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/** Effective model: DB option (if non-empty) → env → built-in default. */
export async function getGeminiModel(): Promise<string> {
  const dbVal = (await getOption(OPT_MODEL))?.trim();
  if (dbVal) return dbVal;
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/** Effective Gemini client, or null when no key is configured (DB or env). */
export async function getGeminiClient(): Promise<GoogleGenAI | null> {
  const key = await resolveApiKey();
  if (!key) {
    cached = null;
    return null;
  }
  if (cached && cached.key === key) return cached.client;
  const client = new GoogleGenAI({ apiKey: key });
  cached = { key, client };
  return client;
}

export interface GeminiStatus {
  configured: boolean;
  source: 'db' | 'env' | null;
  model: string;
  maskedKey: string | null;
}

/** Mask a key for display — never return the raw secret to the client. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Status for the Settings → Integrations card. */
export async function getGeminiStatus(): Promise<GeminiStatus> {
  const dbVal = (await getOption(OPT_API_KEY))?.trim();
  const envVal = process.env.GEMINI_API_KEY?.trim();
  const key = dbVal || envVal || null;
  return {
    configured: !!key,
    source: dbVal ? 'db' : envVal ? 'env' : null,
    model: await getGeminiModel(),
    maskedKey: key ? maskKey(key) : null,
  };
}

/**
 * Save the API key and/or model from the settings UI. Only the provided fields
 * are written (so changing just the model never wipes the key). Resets the cached
 * client so the next call rebuilds against the new config.
 */
export async function setGeminiConfig(opts: { apiKey?: string; model?: string }): Promise<void> {
  if (opts.apiKey !== undefined) await upsertOption(OPT_API_KEY, opts.apiKey.trim());
  if (opts.model !== undefined) await upsertOption(OPT_MODEL, opts.model.trim());
  cached = null;
}

/** Clear the DB overrides → revert to the env values (if any). */
export async function clearGeminiConfig(): Promise<void> {
  await upsertOption(OPT_API_KEY, '');
  await upsertOption(OPT_MODEL, '');
  cached = null;
}

/** Lightweight connectivity check — a tiny bounded generateContent call. */
export async function testGeminiConnection(): Promise<{ ok: boolean; model: string; error?: string }> {
  const model = await getGeminiModel();
  const client = await getGeminiClient();
  if (!client) return { ok: false, model, error: 'No API key configured' };
  try {
    await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      config: {
        // Same hard cap as the transliteration path: fail fast, never hang. `httpOptions.timeout`
        // is forwarded as the server-side request deadline, and Gemini rejects any deadline under
        // 10s (400 INVALID_ARGUMENT), so 10000ms is the floor — keep the abort aligned with it.
        httpOptions: { timeout: 10000, retryOptions: { attempts: 1 } },
        abortSignal: AbortSignal.timeout(10000),
      },
    });
    return { ok: true, model };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err) };
  }
}
