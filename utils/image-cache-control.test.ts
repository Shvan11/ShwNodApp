/**
 * Tests for the patient-image Cache-Control rule.
 *
 * The bug it closes: thumbnails were sent `public, max-age=604800` whatever the URL,
 * so a path that later held a different photo — deleted, then re-uploaded under the
 * same name — kept showing the old one in the Sequence Files panel AND in the photo
 * editor's crop slot, for a week, across reloads. Long caching is now reserved for a
 * URL whose `v` names the file being sent.
 */
import { describe, expect, it } from 'vitest';
import { imageCacheControl, REVALIDATE, versionMatches } from './image-cache-control.js';

// A real-world stat: NTFS/ext4 mtimes carry a sub-millisecond part.
const MTIME_MS = 1790672188802.277;
const WEEK = { maxAgeSeconds: 604800 };

describe('versionMatches', () => {
  it('accepts the gallery token (Math.round(mtimeMs), epoch ms)', () => {
    expect(versionMatches(String(Math.round(MTIME_MS)), MTIME_MS)).toBe(true);
  });

  it("accepts a folder listing's ISO `modified` (fs.Stats#mtime)", () => {
    expect(versionMatches(new Date(MTIME_MS).toISOString(), MTIME_MS)).toBe(true);
  });

  it('accepts a numeric value (the rule is shared with typed callers)', () => {
    expect(versionMatches(Math.round(MTIME_MS), MTIME_MS)).toBe(true);
  });

  it('rejects the version of a different file at the same path', () => {
    expect(versionMatches(String(Math.round(MTIME_MS) - 5000), MTIME_MS)).toBe(false);
    expect(versionMatches(new Date(MTIME_MS + 1500).toISOString(), MTIME_MS)).toBe(false);
  });

  it('rejects an absent, empty, repeated or garbage token', () => {
    expect(versionMatches(undefined, MTIME_MS)).toBe(false);
    expect(versionMatches('', MTIME_MS)).toBe(false);
    expect(versionMatches(['1790672188802', '1790672188802'], MTIME_MS)).toBe(false);
    expect(versionMatches({ v: '1' }, MTIME_MS)).toBe(false);
    expect(versionMatches('abc', MTIME_MS)).toBe(false);
  });
});

describe('imageCacheControl', () => {
  it('caches a correctly versioned URL privately for the given lifetime', () => {
    expect(imageCacheControl(String(Math.round(MTIME_MS)), MTIME_MS, WEEK)).toBe('private, max-age=604800');
  });

  it('adds `immutable` only when asked (the /DolImgs mount)', () => {
    expect(imageCacheControl(String(Math.round(MTIME_MS)), MTIME_MS, { maxAgeSeconds: 31536000, immutable: true })).toBe(
      'private, max-age=31536000, immutable'
    );
  });

  it('makes an unversioned request revalidate instead of caching it for a week', () => {
    expect(imageCacheControl(undefined, MTIME_MS, WEEK)).toBe(REVALIDATE);
  });

  it('makes a stale version revalidate, so it cannot pin new bytes under an old URL', () => {
    expect(imageCacheControl(String(Math.round(MTIME_MS) - 60_000), MTIME_MS, WEEK)).toBe(REVALIDATE);
  });

  it('is never `public` (PHI must stay out of shared caches)', () => {
    for (const v of [undefined, 'x', String(Math.round(MTIME_MS))]) {
      expect(imageCacheControl(v, MTIME_MS, WEEK)).toMatch(/^private, /);
    }
  });
});
