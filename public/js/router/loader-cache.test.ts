/**
 * Unit tests for the loader sessionStorage cache — TTL, pruning, clearing,
 * quota resilience, and the domain invalidation helpers that mutation sites
 * call (the contract that keeps loader data from going stale after writes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOADER_CACHE_PREFIX,
  LOADER_CACHE_TTL_MS,
  clearLoaderCache,
  clearLoaderCacheKey,
  clearLoaderCacheKeyPrefix,
  invalidateAllTemplateCaches,
  invalidatePatientCache,
  invalidateTemplateCache,
  invalidateTimepointsCache,
  invalidateWorkCache,
  loaderCacheKeys,
  pruneExpiredLoaderCache,
  readLoaderCache,
  writeLoaderCache,
} from '@/router/loader-cache';

/** Seed a raw cache entry, optionally aged by `ageMs`. */
function seed(cacheKey: string, data: unknown, ageMs = 0): void {
  sessionStorage.setItem(
    `${LOADER_CACHE_PREFIX}${cacheKey}`,
    JSON.stringify({ data, timestamp: Date.now() - ageMs })
  );
}

function rawEntry(cacheKey: string): string | null {
  return sessionStorage.getItem(`${LOADER_CACHE_PREFIX}${cacheKey}`);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('read/write roundtrip', () => {
  it('returns written data while fresh', () => {
    writeLoaderCache('patient_7', { patient_name: 'Test' });
    expect(readLoaderCache('patient_7')).toEqual({ patient_name: 'Test' });
  });

  it('misses and evicts an expired entry', () => {
    seed('patient_7', { patient_name: 'Old' }, LOADER_CACHE_TTL_MS + 1);
    expect(readLoaderCache('patient_7')).toBeUndefined();
    expect(rawEntry('patient_7')).toBeNull();
  });

  it('misses and evicts an unparseable entry', () => {
    sessionStorage.setItem(`${LOADER_CACHE_PREFIX}patient_7`, 'not-json{');
    expect(readLoaderCache('patient_7')).toBeUndefined();
    expect(rawEntry('patient_7')).toBeNull();
  });

  it('misses on an absent key', () => {
    expect(readLoaderCache('nope')).toBeUndefined();
  });

  it('swallows a quota error on write instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => writeLoaderCache('patient_7', { big: 'payload' })).not.toThrow();
  });
});

describe('pruneExpiredLoaderCache', () => {
  it('drops expired and unparseable entries, keeps fresh and foreign keys', () => {
    seed('fresh', 1);
    seed('expired', 2, LOADER_CACHE_TTL_MS + 1);
    sessionStorage.setItem(`${LOADER_CACHE_PREFIX}garbage`, '{{{');
    sessionStorage.setItem('unrelated_key', 'kept');

    pruneExpiredLoaderCache();

    expect(rawEntry('fresh')).not.toBeNull();
    expect(rawEntry('expired')).toBeNull();
    expect(rawEntry('garbage')).toBeNull();
    expect(sessionStorage.getItem('unrelated_key')).toBe('kept');
  });
});

describe('clearing', () => {
  it('clearLoaderCache removes every prefixed entry and nothing else', () => {
    seed('patient_1', 1);
    seed('work_2', 2);
    sessionStorage.setItem('pm_search_state', 'kept');

    clearLoaderCache();

    expect(rawEntry('patient_1')).toBeNull();
    expect(rawEntry('work_2')).toBeNull();
    expect(sessionStorage.getItem('pm_search_state')).toBe('kept');
  });

  it('clearLoaderCacheKey removes exactly one entry', () => {
    seed('patient_1', 1);
    seed('patient_12', 2);
    clearLoaderCacheKey('patient_1');
    expect(rawEntry('patient_1')).toBeNull();
    expect(rawEntry('patient_12')).not.toBeNull();
  });

  it('clearLoaderCacheKeyPrefix removes the matching keyspace', () => {
    seed('template_list', 1);
    seed('template_3', 2);
    seed('patient_3', 3);
    clearLoaderCacheKeyPrefix('template_');
    expect(rawEntry('template_list')).toBeNull();
    expect(rawEntry('template_3')).toBeNull();
    expect(rawEntry('patient_3')).not.toBeNull();
  });
});

describe('domain invalidation helpers', () => {
  it('invalidatePatientCache clears only that patient', () => {
    seed(loaderCacheKeys.patient(7), 'a');
    seed(loaderCacheKeys.patient(70), 'b');
    seed(loaderCacheKeys.timepoints(7), 'c');
    invalidatePatientCache(7);
    expect(readLoaderCache(loaderCacheKeys.patient(7))).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.patient(70))).toBe('b');
    expect(readLoaderCache(loaderCacheKeys.timepoints(7))).toBe('c');
  });

  it('invalidateWorkCache clears only that work', () => {
    seed(loaderCacheKeys.work(5), 'a');
    seed(loaderCacheKeys.work(55), 'b');
    invalidateWorkCache(5);
    expect(readLoaderCache(loaderCacheKeys.work(5))).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.work(55))).toBe('b');
  });

  it('invalidateTimepointsCache clears only that patient timepoints', () => {
    seed(loaderCacheKeys.timepoints(7), 'a');
    seed(loaderCacheKeys.patient(7), 'b');
    invalidateTimepointsCache(7);
    expect(readLoaderCache(loaderCacheKeys.timepoints(7))).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.patient(7))).toBe('b');
  });

  it('invalidateTemplateCache clears the list, and the single entry when given an id', () => {
    seed(loaderCacheKeys.templateList(), 'list');
    seed(loaderCacheKeys.template(3), 'three');
    invalidateTemplateCache();
    expect(readLoaderCache(loaderCacheKeys.templateList())).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.template(3))).toBe('three');

    seed(loaderCacheKeys.templateList(), 'list');
    invalidateTemplateCache(3);
    expect(readLoaderCache(loaderCacheKeys.templateList())).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.template(3))).toBeUndefined();
  });

  it('invalidateAllTemplateCaches clears the whole template keyspace', () => {
    seed(loaderCacheKeys.templateList(), 'list');
    seed(loaderCacheKeys.template(1), 'one');
    seed(loaderCacheKeys.template(2), 'two');
    seed(loaderCacheKeys.patient(1), 'kept');
    invalidateAllTemplateCaches();
    expect(readLoaderCache(loaderCacheKeys.templateList())).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.template(1))).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.template(2))).toBeUndefined();
    expect(readLoaderCache(loaderCacheKeys.patient(1))).toBe('kept');
  });
});
