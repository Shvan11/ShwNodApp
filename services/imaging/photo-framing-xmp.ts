/**
 * A saved photo view's framing, carried INSIDE the rendered JPEG as XMP.
 *
 * The photo editor renders each view from an original + a framing (zoom, rotation,
 * flips, frame position). Recording that framing is what lets the editor reopen a
 * saved view where it was left ("Continue editing") instead of from scratch. It lives
 * in the image it produced rather than in a table so the two can never disagree: a
 * render replaced by any other route (Dolphin, a build before this record existed)
 * simply carries none, and a removed view takes its record with it.
 *
 * Pure (no fs, no sharp, no config) so it is unit-testable in the env-less CI gate:
 * the render service hands `framingToXmp`'s packet to sharp's `withXmp`, and the read
 * side hands `sharp().metadata().xmp` to `framingFromXmp`.
 *
 * The record is JSON (shape: `savedFraming` in shared/contracts/photo-editor.contract)
 * in one element of a private namespace. It is XML-escaped, so a file name holding
 * `&` or `<` survives the round trip.
 */
import { savedFraming, type SavedFraming } from '../../shared/contracts/photo-editor.contract.js';

/** The namespace the record lives in. Product-scoped, never a clinic's domain. */
export const FRAMING_XMP_NS = 'urn:x-photo-editor:framing:1#';

const ELEMENT_RE = /<pe:framing>([\s\S]*?)<\/pe:framing>/;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeXml(s: string): string {
  // &amp; last, so an escaped entity's own text (`&amp;lt;`) is not decoded twice.
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** A complete XMP packet holding `framing`, ready for sharp's `withXmp`. */
export function framingToXmp(framing: SavedFraming): string {
  const json = escapeXml(JSON.stringify(framing));
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    `<rdf:Description rdf:about="" xmlns:pe="${FRAMING_XMP_NS}">` +
    `<pe:framing>${json}</pe:framing>` +
    '</rdf:Description></rdf:RDF></x:xmpmeta>' +
    '<?xpacket end="w"?>'
  );
}

/**
 * The framing recorded in an image's XMP, or null when it carries none, or one this
 * build cannot read (malformed, or a future record version). Never throws: a photo
 * without a usable record is still a photo, it is just reopened from scratch.
 */
export function framingFromXmp(xmp: Uint8Array | string | null | undefined): SavedFraming | null {
  if (!xmp || xmp.length === 0) return null;
  const text = typeof xmp === 'string' ? xmp : new TextDecoder().decode(xmp);
  const m = ELEMENT_RE.exec(text);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unescapeXml(m[1]));
  } catch {
    return null;
  }
  const result = savedFraming.safeParse(parsed);
  return result.success ? result.data : null;
}
