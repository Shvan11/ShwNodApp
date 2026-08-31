/**
 * The sentinel a masked secret is displayed as, shared by every layer that has to
 * recognise it: the service that masks on read, the route that masks on write-back,
 * and the settings form that must not send it back as if the user had typed it.
 *
 * It existed as four separate hardcoded `'••••••••'` literals, and the gap that
 * opened between them was a real bug: the connection-test path checked for the
 * mask and refused, while the SAVE path did not — so saving the DB settings form
 * without retyping the password wrote the bullet characters into `.env` as the
 * literal PostgreSQL password, and the app could not authenticate after restart.
 *
 * Treat it as an opaque marker, never as data: `isMaskedSecret(value)` means "the
 * user did not change this field — keep whatever is already stored".
 */

export const MASKED_SECRET = '••••••••';

/** Is this value the display mask rather than a real secret the user typed? */
export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === MASKED_SECRET;
}
