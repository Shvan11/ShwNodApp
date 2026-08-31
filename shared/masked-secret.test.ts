/**
 * Tests for the masked-secret sentinel.
 *
 * The mask existed as four separate hardcoded literals and one of them was
 * missing a check: saving the DB settings form without retyping the password
 * wrote the bullet characters into `.env` as the literal PostgreSQL password.
 * `isMaskedSecret` is the shared predicate both halves of that path now use.
 */
import { describe, expect, it } from 'vitest';
import { MASKED_SECRET, isMaskedSecret } from './masked-secret.js';

describe('isMaskedSecret', () => {
  it('recognises the mask itself', () => {
    expect(isMaskedSecret(MASKED_SECRET)).toBe(true);
  });

  it('recognises the mask with incidental surrounding whitespace', () => {
    expect(isMaskedSecret(` ${MASKED_SECRET} `)).toBe(true);
  });

  it('treats a real password as a real password', () => {
    expect(isMaskedSecret('Yarmok11')).toBe(false);
    expect(isMaskedSecret('correct horse battery staple')).toBe(false);
  });

  it('does not mistake a shorter or longer run of bullets for the mask', () => {
    // Only the exact sentinel means "unchanged" — anything else is user input.
    expect(isMaskedSecret('•••')).toBe(false);
    expect(isMaskedSecret(`${MASKED_SECRET}•`)).toBe(false);
  });

  it('is false for empty and non-string values', () => {
    // An empty password is meaningful (trust/peer auth) and must be persisted.
    expect(isMaskedSecret('')).toBe(false);
    expect(isMaskedSecret(undefined)).toBe(false);
    expect(isMaskedSecret(null)).toBe(false);
    expect(isMaskedSecret(12345)).toBe(false);
  });
});
