/**
 * Loader sessionStorage cache — primitives, canonical keys, invalidation.
 *
 * apiLoader() (loaders.ts) caches selected GET responses in sessionStorage for
 * LOADER_CACHE_TTL_MS so back/forward navigation re-renders instantly. The flip
 * side: a mutation makes the cached entry stale for up to the full TTL unless it
 * is explicitly invalidated. So the contract is:
 *
 *   Every mutation that changes data served by a cached loader MUST call the
 *   matching invalidate*() helper after the request succeeds.
 *
 * Key strings are built ONLY through `loaderCacheKeys` — the loaders and the
 * invalidation helpers share the same builders, so a key can't silently drift.
 */

interface CachedEntry<T> {
  data: T;
  timestamp: number;
}

export const LOADER_CACHE_PREFIX = 'loader_cache_';
export const LOADER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Canonical cache-key builders — the single source of truth for every key the
 * loader cache uses. Add new cached loaders here, never as inline strings.
 */
export const loaderCacheKeys = {
  /** GET /api/patients/:id/info — patient demographics (incl. estimated_cost). */
  patient: (personId: number | string): string => `patient_${personId}`,
  /** GET /api/getworkdetails?workId= — single work row (type/doctor/status…). */
  work: (workId: number | string): string => `work_${workId}`,
  /** GET /api/patients/:id/timepoints — timepoint list for photos/compare/xrays. */
  timepoints: (personId: number | string): string => `timepoints_${personId}`,
  /** GET /api/aligner/doctors — aligner doctors list. */
  alignerDoctors: (): string => 'aligner_doctors',
  /** GET /api/templates — template list. */
  templateList: (): string => 'template_list',
  /** GET /api/templates/:id — single template. */
  template: (templateId: number | string): string => `template_${templateId}`,
} as const;

/**
 * Best-effort sweep of expired loader cache entries. Entries are only evicted
 * lazily on a re-read of the same key, so dates/patients/works browsed once
 * otherwise accumulate until they hit the sessionStorage quota. Run on each
 * write to keep the keyspace bounded. Never throws (storage access can fail).
 */
export function pruneExpiredLoaderCache(): void {
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || !key.startsWith(LOADER_CACHE_PREFIX)) continue;
      try {
        const raw = sessionStorage.getItem(key);
        const { timestamp } = JSON.parse(raw ?? '{}') as Partial<CachedEntry<unknown>>;
        if (typeof timestamp !== 'number' || now - timestamp >= LOADER_CACHE_TTL_MS) {
          stale.push(key);
        }
      } catch {
        stale.push(key); // unparseable entry — drop it
      }
    }
    for (const key of stale) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage unavailable — nothing to prune.
  }
}

/**
 * Read a cached loader response. Returns undefined on miss, expiry, parse
 * failure, or unavailable storage — the caller falls through to a fresh fetch.
 */
export function readLoaderCache<T>(cacheKey: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(`${LOADER_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return undefined;
    try {
      const { data, timestamp } = JSON.parse(raw) as CachedEntry<T>;
      if (typeof timestamp === 'number' && Date.now() - timestamp < LOADER_CACHE_TTL_MS) {
        if (import.meta.env.DEV) console.log(`[Loader] Cache hit for ${cacheKey}`);
        return data;
      }
      sessionStorage.removeItem(`${LOADER_CACHE_PREFIX}${cacheKey}`); // expired
    } catch {
      sessionStorage.removeItem(`${LOADER_CACHE_PREFIX}${cacheKey}`); // unparseable
    }
  } catch {
    // sessionStorage unavailable.
  }
  return undefined;
}

/**
 * Cache a loader response (best-effort — a large payload can throw
 * QuotaExceededError, which must not fail the route loader).
 */
export function writeLoaderCache(cacheKey: string, data: unknown): void {
  // Evict expired entries before writing so the keyspace stays bounded
  // (and to free room that might otherwise trip the quota below).
  pruneExpiredLoaderCache();
  try {
    sessionStorage.setItem(
      `${LOADER_CACHE_PREFIX}${cacheKey}`,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // Quota exceeded or serialization failed — skip caching this entry.
  }
}

/**
 * Clear all loader caches.
 * Used on logout (a successor user must never see the predecessor's data).
 */
export function clearLoaderCache(): void {
  try {
    const keys = Object.keys(sessionStorage);
    keys.forEach((key) => {
      if (key.startsWith(LOADER_CACHE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    });
    if (import.meta.env.DEV) console.log('[Loader] Cache cleared');
  } catch {
    // sessionStorage unavailable.
  }
}

/**
 * Clear specific loader cache by key
 *
 * @param cacheKey - Cache key to clear (build it via loaderCacheKeys)
 */
export function clearLoaderCacheKey(cacheKey: string): void {
  try {
    sessionStorage.removeItem(`${LOADER_CACHE_PREFIX}${cacheKey}`);
    if (import.meta.env.DEV) console.log(`[Loader] Cache cleared for ${cacheKey}`);
  } catch {
    // sessionStorage unavailable.
  }
}

/** Clear every loader cache entry whose key starts with the given prefix. */
export function clearLoaderCacheKeyPrefix(keyPrefix: string): void {
  try {
    const fullPrefix = `${LOADER_CACHE_PREFIX}${keyPrefix}`;
    const keys = Object.keys(sessionStorage);
    keys.forEach((key) => {
      if (key.startsWith(fullPrefix)) {
        sessionStorage.removeItem(key);
      }
    });
    if (import.meta.env.DEV) console.log(`[Loader] Cache cleared for prefix ${keyPrefix}`);
  } catch {
    // sessionStorage unavailable.
  }
}

// ---------------------------------------------------------------------------
// Domain invalidation — call these from mutation sites after a write succeeds.
// ---------------------------------------------------------------------------

/** Patient demographics changed (edit / delete / estimated-cost update). */
export function invalidatePatientCache(personId: number | string): void {
  clearLoaderCacheKey(loaderCacheKeys.patient(personId));
}

/** A work row changed (update / finish). */
export function invalidateWorkCache(workId: number | string): void {
  clearLoaderCacheKey(loaderCacheKeys.work(workId));
}

/** A patient's timepoints changed (created / renamed / deleted). */
export function invalidateTimepointsCache(personId: number | string): void {
  clearLoaderCacheKey(loaderCacheKeys.timepoints(personId));
}

/**
 * A template changed. Clears the list, plus the single-template entry when an
 * id is given. Note `template_list` shares the `template_` prefix, so the
 * default-flip case below also covers it.
 */
export function invalidateTemplateCache(templateId?: number | string): void {
  clearLoaderCacheKey(loaderCacheKeys.templateList());
  if (templateId !== undefined) {
    clearLoaderCacheKey(loaderCacheKeys.template(templateId));
  }
}

/**
 * A template default-flip changed OTHER rows too (the previous default was
 * unset server-side), so every cached single template may be stale — clear the
 * whole template keyspace.
 */
export function invalidateAllTemplateCaches(): void {
  clearLoaderCacheKeyPrefix('template_');
}
