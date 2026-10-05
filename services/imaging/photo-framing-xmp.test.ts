import { describe, expect, it } from 'vitest';
import type { SavedFraming } from '../../shared/contracts/photo-editor.contract.js';
import { framingFromXmp, framingToXmp } from './photo-framing-xmp.js';

const sample: SavedFraming = {
  v: 1,
  source: { name: 'IMG_0042.jpg', modified: '2026-10-05T08:15:30.123Z', width: 4032, height: 3024 },
  rotation: 350,
  flipH: true,
  flipV: false,
  zoom: 1.35,
  area: { x: 12.5, y: -3.25, width: 61.2, height: 70.4 },
};

describe('framing XMP record', () => {
  it('round-trips through the packet text and through bytes', () => {
    const packet = framingToXmp(sample);
    expect(framingFromXmp(packet)).toEqual(sample);
    expect(framingFromXmp(new TextEncoder().encode(packet))).toEqual(sample);
  });

  it('survives file names that are not XML-safe, and Arabic ones', () => {
    const tricky = { ...sample, source: { ...sample.source, name: 'صورة & <1> "a".jpg' } };
    const packet = framingToXmp(tricky);
    // The JSON sits in element text: no raw `<` or `&` from the name may reach the XML.
    expect(packet).not.toContain('<1>');
    expect(packet).not.toContain(' & ');
    expect(framingFromXmp(packet)).toEqual(tricky);
  });

  it('keeps a null source mtime', () => {
    const noMtime = { ...sample, source: { ...sample.source, modified: null } };
    expect(framingFromXmp(framingToXmp(noMtime))).toEqual(noMtime);
  });

  it('is a well-formed XMP packet in the private namespace', () => {
    const packet = framingToXmp(sample);
    expect(packet.startsWith('<?xpacket begin=')).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(packet).toContain('xmlns:pe="urn:x-photo-editor:framing:1#"');
  });

  it('reads nothing from an image that carries no record', () => {
    expect(framingFromXmp(undefined)).toBeNull();
    expect(framingFromXmp(null)).toBeNull();
    expect(framingFromXmp('')).toBeNull();
    expect(framingFromXmp(new Uint8Array())).toBeNull();
    // Another tool's XMP, without our element.
    expect(
      framingFromXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description/></rdf:RDF></x:xmpmeta>')
    ).toBeNull();
  });

  it('refuses a record it cannot trust instead of throwing', () => {
    const wrap = (inner: string): string => `<pe:framing>${inner}</pe:framing>`;
    expect(framingFromXmp(wrap('{not json'))).toBeNull();
    // A future record version, a zero-sized frame, a missing field.
    expect(framingFromXmp(wrap(JSON.stringify({ ...sample, v: 2 })))).toBeNull();
    expect(framingFromXmp(wrap(JSON.stringify({ ...sample, area: { ...sample.area, width: 0 } })))).toBeNull();
    const { zoom: _zoom, ...noZoom } = sample;
    expect(framingFromXmp(wrap(JSON.stringify(noZoom)))).toBeNull();
  });
});
