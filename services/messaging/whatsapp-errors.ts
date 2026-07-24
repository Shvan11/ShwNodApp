// services/messaging/whatsapp-errors.ts
//
// Translate raw whatsapp-web.js / Puppeteer failures into reasons a front-desk
// user can act on. The raw messages are library internals ("t", "No LID for
// user\ns (https://static.whatsapp.net/…)", "Runtime.callFunctionOn timed
// out…") and were surfacing verbatim in the send page's failure list. Keep the
// raw text in the log line; show the humanized reason everywhere else.

/**
 * Stall-type failure: the embedded WhatsApp Web page stopped responding (a
 * Puppeteer protocol timeout, our own withTimeout, or a dead page/browser).
 * These are CONNECTION failures, not per-recipient failures — two in a row
 * mean every further send in a batch is doomed, so the batch aborts early.
 */
export function isConnectionStallError(raw: string | null | undefined): boolean {
  const msg = (raw ?? '').trim();
  return (
    /runtime\.callfunctionon timed out|protocoltimeout|protocol error|target closed|session closed|browser has disconnected|execution context was destroyed/i.test(
      msg
    ) || /^timeout after \d+ms/i.test(msg)
  );
}

/**
 * whatsapp-web.js resolved a send WITHOUT throwing but handed back no usable
 * message object/id. This means WhatsApp Web renamed/reshaped an internal field
 * again (cf. the `_serialized` -> `$1` break) and the library needs updating.
 * Like a stall it is a GLOBAL failure — every send in the batch hits it, not one
 * recipient — so the batch aborts early. Unlike a stall, a client restart won't
 * fix a library-version mismatch, so the caller must NOT restart on this.
 */
export const MALFORMED_SEND_RESULT_ERROR =
  'WhatsApp returned an empty send result (whatsapp-web.js may need updating)';

export function isMalformedSendResultError(raw: string | null | undefined): boolean {
  return (raw ?? '').trim() === MALFORMED_SEND_RESULT_ERROR;
}

/**
 * Map a raw send error to a human-readable failure reason.
 * Falls back to the raw message when no signature matches.
 */
export function humanizeWhatsAppError(raw: string | null | undefined): string {
  const msg = (raw ?? '').trim();

  if (!msg) return 'Unknown error — no reason reported by WhatsApp';

  // "No LID for user" = WhatsApp has no account linked to this number.
  if (/no lid for user/i.test(msg)) {
    return 'This number is not registered on WhatsApp';
  }

  // whatsapp-web.js throws when the chat id can't be resolved.
  if (/invalid wid|wid error|phone number is not registered/i.test(msg)) {
    return 'Invalid phone number for WhatsApp';
  }

  // Puppeteer protocol stalls: the embedded WhatsApp Web page stopped
  // responding — the message never left this computer.
  if (isConnectionStallError(msg)) {
    return 'WhatsApp connection stalled — the message was NOT sent. Restart WhatsApp and retry.';
  }

  if (/not ready|client not ready|disconnected during/i.test(msg)) {
    return 'WhatsApp is not connected';
  }

  // The library returned no message id — WhatsApp Web changed and the app needs
  // an update. The message MAY have gone out, so tell the user to verify.
  if (isMalformedSendResultError(msg)) {
    return 'WhatsApp returned an unexpected result — the message may have been sent. Verify on the phone before resending; the app may need an update.';
  }

  // Minified WhatsApp Web internals throw single-letter errors (observed: "t").
  // They carry no information; say so instead of printing garbage.
  if (msg.length <= 3) {
    return 'WhatsApp rejected the message (unknown reason — the number may not be on WhatsApp)';
  }

  return msg;
}
