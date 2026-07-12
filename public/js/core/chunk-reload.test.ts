/**
 * Unit tests for the chunk-load failure classifiers and the reload guard's
 * exhausted path. The classifier regexes are the risky surface: too narrow and
 * a stale tab stops self-healing; too broad and real bugs get treated as deploy
 * noise (isChunkFetchMessage doubles as the error-reporter's skip filter).
 * The actual reload flow is exercised end-to-end against a built bundle
 * (break a chunk, observe reload-once → error UI + report), not simulated here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ChunkReloadModule = typeof import('./chunk-reload');

// The module holds state (reloadPending, installed) — import a fresh copy per test.
async function importFresh(): Promise<ChunkReloadModule> {
  vi.resetModules();
  return import('./chunk-reload');
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('isChunkFetchMessage (self-heal set — also the reporter skip filter)', () => {
  it('matches the import() rejection phrasings of all three engines', async () => {
    const { isChunkFetchMessage } = await importFresh();
    // Chrome
    expect(
      isChunkFetchMessage('Failed to fetch dynamically imported module: https://x/assets/A-abc.js')
    ).toBe(true);
    // Firefox
    expect(isChunkFetchMessage('error loading dynamically imported module')).toBe(true);
    // Safari
    expect(isChunkFetchMessage('Importing a module script failed.')).toBe(true);
  });

  it("matches Vite's CSS-dep preload failure", async () => {
    const { isChunkFetchMessage } = await importFresh();
    expect(isChunkFetchMessage('Unable to preload CSS for /assets/Expenses-abc.css')).toBe(true);
  });

  it('does NOT match ordinary errors (would suppress their reporting)', async () => {
    const { isChunkFetchMessage } = await importFresh();
    expect(isChunkFetchMessage('Failed to fetch')).toBe(false); // plain network error
    expect(isChunkFetchMessage("Cannot read properties of undefined (reading 'default')")).toBe(
      false // manufactured render signature — reload-worthy but must stay reportable
    );
    expect(isChunkFetchMessage('Request timed out')).toBe(false);
  });
});

describe('isChunkLoadError (boundary reload decision — fetch + manufactured signatures)', () => {
  it('matches the undefined-module render TypeErrors, old and new Chrome phrasing', async () => {
    const { isChunkLoadError } = await importFresh();
    expect(isChunkLoadError("Cannot read properties of undefined (reading 'default')")).toBe(true);
    expect(isChunkLoadError("Cannot read property 'default' of undefined")).toBe(true);
  });

  it("matches Safari's undefined-module phrasing", async () => {
    const { isChunkLoadError } = await importFresh();
    expect(isChunkLoadError("undefined is not an object (evaluating 'n.default')")).toBe(true);
  });

  it('stays tight to `.default` — ordinary undefined-property bugs must not reload', async () => {
    const { isChunkLoadError } = await importFresh();
    expect(isChunkLoadError("Cannot read properties of undefined (reading 'name')")).toBe(false);
    expect(isChunkLoadError("undefined is not an object (evaluating 'patient.works')")).toBe(false);
    expect(isChunkLoadError('x is undefined')).toBe(false); // Firefox phrasing: too generic, deliberately unmatched
  });

  it('includes the whole fetch set', async () => {
    const { isChunkLoadError } = await importFresh();
    expect(isChunkLoadError('Failed to fetch dynamically imported module: /assets/B.js')).toBe(true);
  });
});

describe('selfHealChunkError', () => {
  it('passes non-chunk errors through untouched', async () => {
    const { selfHealChunkError } = await importFresh();
    expect(selfHealChunkError('boom: patients is not iterable', 'test')).toBe('not-chunk-error');
    // No reload budget consumed for non-chunk errors.
    expect(sessionStorage.getItem('shwan_chunk_reload_ts')).toBeNull();
  });

  it('reports reload-exhausted (→ caller must report) when the cooldown is active', async () => {
    const { selfHealChunkError } = await importFresh();
    // A reload just happened — flag is fresh.
    sessionStorage.setItem('shwan_chunk_reload_ts', String(Date.now()));
    expect(
      selfHealChunkError('Failed to fetch dynamically imported module: /assets/C.js', 'test')
    ).toBe('reload-exhausted');
  });
});
