import { describe, it, expect } from 'vitest';
import { buildCacheControl, HASHED_ASSET, ALWAYS_REVALIDATE } from './build-cache-control.js';

describe('buildCacheControl', () => {
  it('caches a hashed asset for a year, on either path style', () => {
    expect(buildCacheControl('/srv/app/dist/assets/main-B5Mf_65y.js')).toBe(HASHED_ASSET);
    expect(buildCacheControl('C:\\ShwNodApp\\dist\\assets\\fa-solid-900-tLH6XCuf.woff2')).toBe(HASHED_ASSET);
    expect(HASHED_ASSET).toContain('immutable');
  });

  it('revalidates the HTML shells, which name the current build', () => {
    expect(buildCacheControl('/srv/app/dist/index.html')).toBe(ALWAYS_REVALIDATE);
    expect(buildCacheControl('C:\\ShwNodApp\\dist\\portal.html')).toBe(ALWAYS_REVALIDATE);
  });

  it('does not treat a folder merely named assets higher up as the asset folder', () => {
    expect(buildCacheControl('/srv/assets/app/dist/index.html')).toBe(ALWAYS_REVALIDATE);
    expect(buildCacheControl('/srv/app/dist/assets/nested/file.js')).toBe(ALWAYS_REVALIDATE);
  });
});
